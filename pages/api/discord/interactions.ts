import type { NextApiRequest, NextApiResponse } from "next";
import nacl from "tweetnacl";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assignRolesFromRegistration, editOriginalInteractionResponse } from "../../../lib/discord/assignRolesFromRegistration";

export const config = {
  api: {
    bodyParser: false,
  },
};

const ENABLE_VERIFY_TIMING_LOGS = process.env.VERIFY_TIMING_LOGS !== "0";

type RuntimeConfig = {
  discordPublicKeyHex: string;
  supabase: SupabaseClient;
};

type EnvResolutionSpec = {
  primaryName: string;
  fallbackName?: string;
};

class MissingEnvError extends Error {
  missingVars: string[];

  constructor(missingVars: string[]) {
    super(`Missing required env vars: ${missingVars.join(", ")}`);
    this.name = "MissingEnvError";
    this.missingVars = missingVars;
  }
}

let runtimeConfigCache: RuntimeConfig | null = null;

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function resolveEnvValue(spec: EnvResolutionSpec): string | null {
  const primaryValue = readEnv(spec.primaryName);
  if (primaryValue) {
    return primaryValue;
  }

  if (spec.fallbackName) {
    return readEnv(spec.fallbackName) ?? null;
  }

  return null;
}

function getRuntimeConfig(): RuntimeConfig {
  if (runtimeConfigCache) {
    return runtimeConfigCache;
  }

  const specs: EnvResolutionSpec[] = [
    { primaryName: "DISCORD_PUBLIC_KEY", fallbackName: "PUBLIC_KEY" },
    { primaryName: "SUPABASE_URL" },
    { primaryName: "SUPABASE_SERVICE_ROLE_KEY", fallbackName: "SUPABASE_KEY" },
  ];

  const resolved: Record<string, string> = {};
  const missingVars: string[] = [];

  for (const spec of specs) {
    const value = resolveEnvValue(spec);
    if (value) {
      resolved[spec.primaryName] = value;
      continue;
    }

    missingVars.push(
      spec.fallbackName
        ? `${spec.primaryName} (or legacy fallback ${spec.fallbackName})`
        : spec.primaryName
    );
  }

  if (missingVars.length > 0) {
    throw new MissingEnvError(missingVars);
  }

  runtimeConfigCache = {
    discordPublicKeyHex: resolved.DISCORD_PUBLIC_KEY,
    supabase: createClient(resolved.SUPABASE_URL, resolved.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
  return runtimeConfigCache;
}

type DiscordUser = {
  id: string;
  username: string;
};

type Interaction = {
  id: string;
  token: string;
  application_id: string;
  type: number;
  guild_id?: string;
  data?: {
    name?: string;
    options?: Array<{ name: string; type: number; value?: string }>;
  };
  member?: {
    user?: DiscordUser;
    roles?: string[];
  };
  user?: DiscordUser;
};

type Registration = {
  email: string;
  first_name: string;
  last_name: string;
  discord_user_id: string | null;
  fields_of_study: string[] | null;
  interests: string[] | null;
  level_of_study: string | null;
  school: string | null;
  school_other: string | null;
  team_mode: string | null;
  team_name: string | null;
};

function interactionResponse(content: string) {
  return {
    type: 4,
    data: {
      content,
      flags: 64,
    },
  };
}

async function readRawBody(req: NextApiRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function verifyDiscordRequest(rawBody: Buffer, signature: string, timestamp: string, publicKeyHex: string): boolean {
  try {
    const message = Buffer.concat([Buffer.from(timestamp, "utf8"), rawBody]);
    const signatureBytes = Buffer.from(signature, "hex");
    const publicKeyBytes = Buffer.from(publicKeyHex, "hex");
    return nacl.sign.detached.verify(message, signatureBytes, publicKeyBytes);
  } catch {
    return false;
  }
}

function getDiscordUser(interaction: Interaction): DiscordUser | null {
  return interaction.member?.user ?? interaction.user ?? null;
}

function getEmailOption(interaction: Interaction): string | null {
  const value = interaction.data?.options?.find((option) => option.name === "email")?.value;
  if (!value || typeof value !== "string") {
    return null;
  }

  return value.trim().toLowerCase();
}

function escapePostgresLike(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

function interactionDeferredResponse() {
  return {
    type: 5,
    data: {
      flags: 64,
    },
  };
}

const REGISTRATION_SELECT =
  "email, first_name, last_name, discord_user_id, fields_of_study, interests, level_of_study, school, school_other, team_mode, team_name";

async function findByDiscordUserId(discordUserId: string): Promise<Registration | null> {
  const supabase = getRuntimeConfig().supabase;
  const { data, error } = await supabase
    .from("registrations")
    .select(REGISTRATION_SELECT)
    .eq("discord_user_id", discordUserId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as Registration | null) ?? null;
}

async function findByEmailCaseInsensitive(normalizedEmail: string): Promise<Registration | null> {
  const supabase = getRuntimeConfig().supabase;
  const escapedEmail = escapePostgresLike(normalizedEmail);
  const { data, error } = await supabase
    .from("registrations")
    .select(REGISTRATION_SELECT)
    .ilike("email", escapedEmail)
    .limit(2);

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    return null;
  }

  if (data.length > 1) {
    throw new Error("Multiple registrations matched this email; expected a single row.");
  }

  return data[0] as Registration;
}

type VerifyResult =
  | { ok: true; registration: Registration }
  | { ok: false; message: string };

async function verifyRegistration(discordUser: DiscordUser, interaction: Interaction): Promise<VerifyResult> {
  const supabase = getRuntimeConfig().supabase;
  const providedEmail = getEmailOption(interaction);

  if (!providedEmail) {
    const existing = await findByDiscordUserId(discordUser.id);
    if (!existing) {
      return {
        ok: false,
        message:
          "I couldn't automatically verify your Discord account. Please run /verify email:<your registration email>.",
      };
    }

    return { ok: true, registration: existing };
  }

  const registration = await findByEmailCaseInsensitive(providedEmail);
  if (!registration) {
    return {
      ok: false,
      message:
        "❌ Could not verify registration for that email. If you already registered, contact staff. Otherwise register at mcgillaerohacks.com.",
    };
  }

  if (registration.discord_user_id && registration.discord_user_id !== discordUser.id) {
    return {
      ok: false,
      message: "❌ That registration is already linked to a different Discord account. Contact staff for help.",
    };
  }

  const { data: updatedRegistration, error: updateError } = await supabase
    .from("registrations")
    .update({
      discord_user_id: discordUser.id,
      discord_username: discordUser.username ?? null,
      discord_verified_at: new Date().toISOString(),
    })
    .eq("email", registration.email)
    .select(REGISTRATION_SELECT)
    .single();

  if (updateError) {
    if ((updateError as { code?: string }).code === "23505") {
      return {
        ok: false,
        message: "❌ This Discord account is already linked to a registration. Contact staff if this is a mistake.",
      };
    }

    throw updateError;
  }

  return { ok: true, registration: updatedRegistration as Registration };
}

function logVerifyTiming(step: string, durationMs: number, details?: string): void {
  if (!ENABLE_VERIFY_TIMING_LOGS) {
    return;
  }
  const suffix = details ? ` ${details}` : "";
  console.info(`[verify-timing] ${step}: ${durationMs.toFixed(1)}ms${suffix}`);
}

function buildVerificationSuccessMessage(
  registration: Registration,
  roleResult: Awaited<ReturnType<typeof assignRolesFromRegistration>> | null,
  guildId: string | undefined
): string {
  const lines = [`✅ Verified: ${registration.first_name} ${registration.last_name}`];

  if (!guildId) {
    lines.push("You're verified, but role assignment only works in a server channel.");
    return lines.join("\n");
  }

  lines.push("We've assigned roles based on your program, interests, school, and team status.");

  if (!roleResult) {
    return lines.join("\n");
  }

  if (roleResult.assignedRoleNames.length > 0) {
    lines.push(`Assigned: ${roleResult.assignedRoleNames.join(", ")}`);
  } else {
    lines.push("No new roles were needed.");
  }

  if (roleResult.failedRoleNames.length > 0) {
    lines.push("Some roles could not be assigned right now. Please contact staff if this persists.");
  }

  return lines.join("\n");
}

async function processVerifyInteraction(interaction: Interaction): Promise<void> {
  const totalStart = performance.now();
  const discordUser = getDiscordUser(interaction);
  if (!discordUser?.id) {
    await editOriginalInteractionResponse({
      applicationId: interaction.application_id,
      interactionToken: interaction.token,
      content: "Could not read your Discord account information.",
    });
    return;
  }

  try {
    const verifyStart = performance.now();
    const verifyResult = await verifyRegistration(discordUser, interaction);
    logVerifyTiming("verifyRegistration", performance.now() - verifyStart, `interaction_id=${interaction.id}`);

    if ("message" in verifyResult) {
      const editStart = performance.now();
      await editOriginalInteractionResponse({
        applicationId: interaction.application_id,
        interactionToken: interaction.token,
        content: verifyResult.message,
      });
      logVerifyTiming("editOriginalInteractionResponse", performance.now() - editStart, "result=failure_message");
      logVerifyTiming("processVerifyInteraction.total", performance.now() - totalStart, "result=failed_verification");
      return;
    }

    let roleResult: Awaited<ReturnType<typeof assignRolesFromRegistration>> | null = null;
    if (interaction.guild_id) {
      const roleStart = performance.now();
      roleResult = await assignRolesFromRegistration({
        guildId: interaction.guild_id,
        discordUserId: discordUser.id,
        registration: verifyResult.registration,
      });
      logVerifyTiming("assignRolesFromRegistration", performance.now() - roleStart, `guild_id=${interaction.guild_id}`);
    }

    const editStart = performance.now();
    await editOriginalInteractionResponse({
      applicationId: interaction.application_id,
      interactionToken: interaction.token,
      content: buildVerificationSuccessMessage(verifyResult.registration, roleResult, interaction.guild_id),
    });
    logVerifyTiming("editOriginalInteractionResponse", performance.now() - editStart, "result=success_message");
    logVerifyTiming("processVerifyInteraction.total", performance.now() - totalStart, "result=success");
  } catch (error) {
    console.error("verify command error", error);
    try {
      const editStart = performance.now();
      await editOriginalInteractionResponse({
        applicationId: interaction.application_id,
        interactionToken: interaction.token,
        content: "An internal error occurred. Please try again later.",
      });
      logVerifyTiming("editOriginalInteractionResponse", performance.now() - editStart, "result=internal_error");
    } catch (followupError) {
      console.error("Failed to send error follow-up:", followupError);
    }
    logVerifyTiming("processVerifyInteraction.total", performance.now() - totalStart, "result=exception");
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  let runtimeConfig: RuntimeConfig;
  try {
    runtimeConfig = getRuntimeConfig();
  } catch (error) {
    if (error instanceof MissingEnvError) {
      console.error(`[config] Missing required env vars: ${error.missingVars.join(", ")}`);
      res.status(500).json({
        error: "Server misconfiguration: missing required environment variables.",
      });
      return;
    }
    console.error("[config] Failed to initialize runtime configuration", error);
    res.status(500).json({ error: "Server misconfiguration." });
    return;
  }

  const signature = req.headers["x-signature-ed25519"];
  const timestamp = req.headers["x-signature-timestamp"];

  if (typeof signature !== "string" || typeof timestamp !== "string") {
    res.status(401).send("Invalid signature");
    return;
  }

  const rawBody = await readRawBody(req);
  if (!verifyDiscordRequest(rawBody, signature, timestamp, runtimeConfig.discordPublicKeyHex)) {
    res.status(401).send("Invalid signature");
    return;
  }

  let interaction: Interaction;
  try {
    interaction = JSON.parse(rawBody.toString("utf8")) as Interaction;
  } catch {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }

  if (interaction.type === 1) {
    res.status(200).json({ type: 1 });
    return;
  }

  if (interaction.type !== 2 || interaction.data?.name !== "verify") {
    res.status(200).json(interactionResponse("Unsupported command."));
    return;
  }

  res.status(200).json(interactionDeferredResponse());
  await processVerifyInteraction(interaction);
}
