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
const MAX_TEAMMATE_RESULTS = Number(process.env.MAX_TEAMMATE_RESULTS ?? "10");
const TEAMMATE_QUERY_LIMIT = Number(process.env.TEAMMATE_QUERY_LIMIT ?? "200");

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

type InteractionOption = {
  name: string;
  type: number;
  value?: string;
};

type Interaction = {
  id: string;
  token: string;
  application_id: string;
  type: number;
  guild_id?: string;
  data?: {
    name?: string;
    options?: InteractionOption[];
  };
  member?: {
    user?: DiscordUser;
    roles?: string[];
  };
  user?: DiscordUser;
};

type RegistrationListField = string[] | string | null;

type Registration = {
  email: string;
  first_name: string;
  last_name: string;
  discord_user_id: string | null;
  fields_of_study: RegistrationListField;
  interests: RegistrationListField;
  level_of_study: string | null;
  school: string | null;
  school_other: string | null;
  team_mode: string | null;
  team_name: string | null;
};

type TeammateCandidate = {
  first_name: string | null;
  last_name: string | null;
  school: string | null;
  level_of_study: string | null;
  interests: RegistrationListField;
  fields_of_study: RegistrationListField;
  discord_user_id: string | null;
  team_mode: string | null;
};

type VerifyResult =
  | { ok: true; registration: Registration }
  | { ok: false; message: string };

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

function getStringOption(interaction: Interaction, optionName: string): string | null {
  const value = interaction.data?.options?.find((option) => option.name === optionName)?.value;
  if (!value || typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getEmailOption(interaction: Interaction): string | null {
  const email = getStringOption(interaction, "email");
  return email ? email.toLowerCase() : null;
}

function getInterestOption(interaction: Interaction): string | null {
  return getStringOption(interaction, "interest");
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

function normalizeListField(value: RegistrationListField): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
  }

  if (typeof value !== "string") {
    return [];
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter((item) => item.length > 0);
      }
    } catch {
      // Fall back to comma-separated parsing below.
    }
  }

  return trimmed
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function isLookingForTeam(teamMode: string | null | undefined): boolean {
  if (!teamMode) {
    return false;
  }

  const normalized = normalizeKey(teamMode).replace(/[_-]+/g, " ");
  return (
    normalized === "free agent" ||
    normalized === "looking for a team" ||
    normalized === "looking for team"
  );
}

function getRegistrationDisplayName(registration: { first_name: string | null; last_name: string | null }): string {
  const first = registration.first_name?.trim() ?? "";
  const last = registration.last_name?.trim() ?? "";
  const joined = `${first} ${last}`.trim();
  return joined || "Unknown";
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

async function editInteractionResponse(interaction: Interaction, content: string): Promise<void> {
  await editOriginalInteractionResponse({
    applicationId: interaction.application_id,
    interactionToken: interaction.token,
    content,
  });
}

const REGISTRATION_SELECT =
  "email, first_name, last_name, discord_user_id, fields_of_study, interests, level_of_study, school, school_other, team_mode, team_name";
const TEAMMATE_SELECT =
  "first_name, last_name, school, level_of_study, interests, fields_of_study, discord_user_id, team_mode";

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

async function findTeammateCandidates(discordUserId: string): Promise<TeammateCandidate[]> {
  const supabase = getRuntimeConfig().supabase;
  const { data, error } = await supabase
    .from("registrations")
    .select(TEAMMATE_SELECT)
    .not("discord_user_id", "is", "null")
    .neq("discord_user_id", discordUserId)
    .limit(Math.max(1, TEAMMATE_QUERY_LIMIT));

  if (error) {
    throw error;
  }

  const rows = (data as TeammateCandidate[] | null) ?? [];
  return rows.filter((row) => Boolean(row.discord_user_id) && isLookingForTeam(row.team_mode));
}

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

function toRoleAssignmentRegistration(registration: Registration) {
  return {
    fields_of_study: normalizeListField(registration.fields_of_study),
    interests: normalizeListField(registration.interests),
    level_of_study: registration.level_of_study,
    school: registration.school,
    school_other: registration.school_other,
    team_mode: registration.team_mode,
    team_name: registration.team_name,
  };
}

function buildStatusMessage(registration: Registration): string {
  const lines = [
    "✅ Your verification status",
    `Name: ${getRegistrationDisplayName(registration)}`,
    `Email: ${registration.email ?? "N/A"}`,
    `School: ${registration.school ?? registration.school_other ?? "N/A"}`,
    `Level: ${registration.level_of_study ?? "N/A"}`,
    `Team mode: ${registration.team_mode ?? "N/A"}`,
  ];

  if (registration.team_name) {
    lines.push(`Team name: ${registration.team_name}`);
  }

  return lines.join("\n");
}

type TeammateMatch = {
  score: number;
  candidate: TeammateCandidate;
  matchedInterests: string[];
  matchedFields: string[];
};

function buildTeammatesMessage(matches: TeammateMatch[], interestFilter: string | null): string {
  const lines: string[] = ["🔍 Potential teammates", ""];

  if (interestFilter) {
    lines.push(`Filter: ${interestFilter}`, "");
  }

  let shown = 0;
  const cappedMatches = matches.slice(0, Math.max(1, MAX_TEAMMATE_RESULTS));

  for (let index = 0; index < cappedMatches.length; index += 1) {
    const match = cappedMatches[index];
    if (!match) {
      continue;
    }

    const candidate = match.candidate;
    const mention = candidate.discord_user_id ? ` <@${candidate.discord_user_id}>` : "";
    const name = getRegistrationDisplayName(candidate);
    const school = candidate.school ?? "N/A";
    const level = candidate.level_of_study ?? "N/A";

    const matchParts: string[] = [];
    if (match.matchedInterests.length > 0) {
      matchParts.push(
        `Interests: ${match.matchedInterests
          .slice(0, 2)
          .map((value) => truncateText(value, 30))
          .join(", ")}`
      );
    }
    if (match.matchedFields.length > 0) {
      matchParts.push(
        `Fields: ${match.matchedFields
          .slice(0, 2)
          .map((value) => truncateText(value, 30))
          .join(", ")}`
      );
    }

    const block = [
      `${shown + 1}. ${name}${mention} (score ${match.score})`,
      `   School: ${truncateText(school, 60)}`,
      `   Level: ${truncateText(level, 60)}`,
      matchParts.length > 0 ? `   Match: ${matchParts.join(" | ")}` : null,
      null,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");

    const tentative = [...lines, block].join("\n");
    if (tentative.length > 1850) {
      break;
    }

    lines.push(block);
    shown += 1;
  }

  if (shown < matches.length) {
    lines.push(`Showing ${shown} of ${matches.length} matches. Refine with interest:<keyword> for a narrower list.`);
  }

  lines.push("", "💡 Reach out in Discord DMs or server channels to form a team.");

  return lines.join("\n");
}

async function processVerifyInteraction(interaction: Interaction): Promise<void> {
  const totalStart = performance.now();
  const discordUser = getDiscordUser(interaction);
  if (!discordUser?.id) {
    await editInteractionResponse(interaction, "Could not read your Discord account information.");
    return;
  }

  try {
    const verifyStart = performance.now();
    const verifyResult = await verifyRegistration(discordUser, interaction);
    logVerifyTiming("verifyRegistration", performance.now() - verifyStart, `interaction_id=${interaction.id}`);

    if (!verifyResult.ok) {
      const editStart = performance.now();
      await editInteractionResponse(interaction, verifyResult.message);
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
        registration: toRoleAssignmentRegistration(verifyResult.registration),
      });
      logVerifyTiming("assignRolesFromRegistration", performance.now() - roleStart, `guild_id=${interaction.guild_id}`);
    }

    const editStart = performance.now();
    await editInteractionResponse(
      interaction,
      buildVerificationSuccessMessage(verifyResult.registration, roleResult, interaction.guild_id)
    );
    logVerifyTiming("editOriginalInteractionResponse", performance.now() - editStart, "result=success_message");
    logVerifyTiming("processVerifyInteraction.total", performance.now() - totalStart, "result=success");
  } catch (error) {
    console.error("verify command error", error);
    try {
      const editStart = performance.now();
      await editInteractionResponse(interaction, "An internal error occurred. Please try again later.");
      logVerifyTiming("editOriginalInteractionResponse", performance.now() - editStart, "result=internal_error");
    } catch (followupError) {
      console.error("Failed to send error follow-up:", followupError);
    }
    logVerifyTiming("processVerifyInteraction.total", performance.now() - totalStart, "result=exception");
  }
}

async function processStatusInteraction(interaction: Interaction): Promise<void> {
  const discordUser = getDiscordUser(interaction);
  if (!discordUser?.id) {
    await editInteractionResponse(interaction, "Could not read your Discord account information.");
    return;
  }

  try {
    const registration = await findByDiscordUserId(discordUser.id);
    if (!registration) {
      await editInteractionResponse(interaction, "❌ You are not verified yet. Use /verify email:<your registration email>.");
      return;
    }

    await editInteractionResponse(interaction, buildStatusMessage(registration));
  } catch (error) {
    console.error("status command error", error);
    await editInteractionResponse(interaction, "An internal error occurred while checking your status.");
  }
}

async function processFindTeammatesInteraction(interaction: Interaction): Promise<void> {
  const discordUser = getDiscordUser(interaction);
  if (!discordUser?.id) {
    await editInteractionResponse(interaction, "Could not read your Discord account information.");
    return;
  }

  try {
    const userRegistration = await findByDiscordUserId(discordUser.id);
    if (!userRegistration) {
      await editInteractionResponse(interaction, "❌ You need to verify first using /verify email:<your registration email>.");
      return;
    }

    const interestFilter = getInterestOption(interaction);
    const normalizedFilter = interestFilter ? normalizeKey(interestFilter) : null;

    const userInterestKeys = new Set(normalizeListField(userRegistration.interests).map(normalizeKey));
    const userFieldKeys = new Set(normalizeListField(userRegistration.fields_of_study).map(normalizeKey));

    const candidates = await findTeammateCandidates(discordUser.id);
    const matches: TeammateMatch[] = [];

    for (const candidate of candidates) {
      const candidateInterests = normalizeListField(candidate.interests);
      const candidateFields = normalizeListField(candidate.fields_of_study);

      if (normalizedFilter) {
        const candidateText = `${candidateInterests.join(" ")} ${candidateFields.join(" ")}`.toLowerCase();
        if (!candidateText.includes(normalizedFilter)) {
          continue;
        }
      }

      const matchedInterests = candidateInterests.filter((value) => userInterestKeys.has(normalizeKey(value)));
      const matchedFields = candidateFields.filter((value) => userFieldKeys.has(normalizeKey(value)));

      const score = matchedInterests.length * 2 + matchedFields.length * 3;
      matches.push({
        score,
        candidate,
        matchedInterests,
        matchedFields,
      });
    }

    matches.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const aName = getRegistrationDisplayName(a.candidate).toLowerCase();
      const bName = getRegistrationDisplayName(b.candidate).toLowerCase();
      return aName.localeCompare(bName);
    });

    if (matches.length === 0) {
      if (interestFilter) {
        await editInteractionResponse(interaction, `😔 No teammates found matching "${interestFilter}". Try a broader filter.`);
      } else {
        await editInteractionResponse(interaction, "😔 No one else is currently marked as looking for a team.");
      }
      return;
    }

    await editInteractionResponse(interaction, buildTeammatesMessage(matches, interestFilter));
  } catch (error) {
    console.error("find_teammates command error", error);
    await editInteractionResponse(interaction, "An internal error occurred while finding teammates.");
  }
}

async function processHelpInteraction(interaction: Interaction): Promise<void> {
  const message = [
    "🤖 AeroHacks Bot Commands",
    "",
    "/verify email:<your registration email> - Verify and link your Discord account.",
    "/status - Show your current verification details.",
    "/find_teammates [interest] - Find participants marked as looking for a team.",
    "/help - Show this message.",
    "",
    "If verification fails, contact staff with your registration email.",
  ].join("\n");

  await editInteractionResponse(interaction, message);
}

async function processCommandInteraction(interaction: Interaction): Promise<void> {
  const commandName = interaction.data?.name;

  if (commandName === "verify") {
    await processVerifyInteraction(interaction);
    return;
  }

  if (commandName === "status") {
    await processStatusInteraction(interaction);
    return;
  }

  if (commandName === "find_teammates") {
    await processFindTeammatesInteraction(interaction);
    return;
  }

  if (commandName === "help") {
    await processHelpInteraction(interaction);
    return;
  }

  await editInteractionResponse(interaction, "Unsupported command.");
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

  if (interaction.type !== 2) {
    res.status(200).json(interactionResponse("Unsupported interaction type."));
    return;
  }

  res.status(200).json(interactionDeferredResponse());
  await processCommandInteraction(interaction);
}
