import type { NextApiRequest, NextApiResponse } from "next";
import nacl from "tweetnacl";
import { createClient } from "@supabase/supabase-js";
import { assignRolesFromRegistration, editOriginalInteractionResponse } from "../../../lib/discord/assignRolesFromRegistration";

export const config = {
  api: {
    bodyParser: false,
  },
};

const DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
const LEGACY_PUBLIC_KEY = process.env.PUBLIC_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LEGACY_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_KEY;

function resolveEnv(primaryName: string, primaryValue: string | undefined, fallbackName?: string, fallbackValue?: string) {
  if (primaryValue) {
    return primaryValue;
  }

  if (fallbackValue) {
    return fallbackValue;
  }

  if (fallbackName) {
    throw new Error(`Missing required env var: ${primaryName} (or legacy fallback ${fallbackName})`);
  }

  throw new Error(`Missing required env var: ${primaryName}`);
}

const DISCORD_PUBLIC_KEY_HEX = resolveEnv("DISCORD_PUBLIC_KEY", DISCORD_PUBLIC_KEY, "PUBLIC_KEY", LEGACY_PUBLIC_KEY);
const SUPABASE_URL_VALUE = resolveEnv("SUPABASE_URL", SUPABASE_URL);
const SUPABASE_SERVICE_ROLE_KEY_VALUE = resolveEnv(
  "SUPABASE_SERVICE_ROLE_KEY",
  SUPABASE_SERVICE_ROLE_KEY,
  "SUPABASE_KEY",
  LEGACY_SUPABASE_SERVICE_ROLE_KEY
);

const supabase = createClient(SUPABASE_URL_VALUE, SUPABASE_SERVICE_ROLE_KEY_VALUE, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const ENABLE_VERIFY_TIMING_LOGS = process.env.VERIFY_TIMING_LOGS !== "0";

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

function verifyDiscordRequest(rawBody: Buffer, signature: string, timestamp: string): boolean {
  try {
    const message = Buffer.concat([Buffer.from(timestamp, "utf8"), rawBody]);
    const signatureBytes = Buffer.from(signature, "hex");
    const publicKeyBytes = Buffer.from(DISCORD_PUBLIC_KEY_HEX, "hex");
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

  const signature = req.headers["x-signature-ed25519"];
  const timestamp = req.headers["x-signature-timestamp"];

  if (typeof signature !== "string" || typeof timestamp !== "string") {
    res.status(401).send("Invalid signature");
    return;
  }

  const rawBody = await readRawBody(req);
  if (!verifyDiscordRequest(rawBody, signature, timestamp)) {
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
