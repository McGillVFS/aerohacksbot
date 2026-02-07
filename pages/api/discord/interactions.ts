import type { NextApiRequest, NextApiResponse } from "next";
import nacl from "tweetnacl";
import { createClient } from "@supabase/supabase-js";

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

type DiscordUser = {
  id: string;
  username: string;
};

type Interaction = {
  type: number;
  data?: {
    name?: string;
    options?: Array<{ name: string; type: number; value?: string }>;
  };
  member?: {
    user?: DiscordUser;
  };
  user?: DiscordUser;
};

type Registration = {
  email: string;
  first_name: string;
  last_name: string;
  discord_user_id: string | null;
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

async function findByDiscordUserId(discordUserId: string): Promise<Registration | null> {
  const { data, error } = await supabase
    .from("registrations")
    .select("email, first_name, last_name, discord_user_id")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as Registration | null) ?? null;
}

async function findByEmailCaseInsensitive(normalizedEmail: string): Promise<Registration | null> {
  const { data, error } = await supabase
    .from("registrations")
    .select("email, first_name, last_name, discord_user_id")
    .ilike("email", normalizedEmail)
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

async function discordLinkedElsewhere(discordUserId: string, email: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("registrations")
    .select("email")
    .eq("discord_user_id", discordUserId)
    .neq("email", email)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
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

  const discordUser = getDiscordUser(interaction);
  if (!discordUser?.id) {
    res.status(200).json(interactionResponse("Could not read your Discord account information."));
    return;
  }

  try {
    const providedEmail = getEmailOption(interaction);

    if (!providedEmail) {
      const existing = await findByDiscordUserId(discordUser.id);
      if (existing) {
        res.status(200).json(interactionResponse(`✅ Verified: ${existing.first_name} ${existing.last_name}`));
        return;
      }

      res
        .status(200)
        .json(
          interactionResponse(
            "I couldn't automatically verify your Discord account. Please run /verify email:<your registration email>."
          )
        );
      return;
    }

    const registration = await findByEmailCaseInsensitive(providedEmail);
    if (!registration) {
      res
        .status(200)
        .json(
          interactionResponse(
            "❌ Could not verify registration for that email. If you already registered, contact staff. Otherwise register at mcgillaerohacks.com."
          )
        );
      return;
    }

    const linkedElsewhere = await discordLinkedElsewhere(discordUser.id, registration.email);
    if (linkedElsewhere) {
      res
        .status(200)
        .json(
          interactionResponse(
            "❌ This Discord account is already linked to a registration. Contact staff if this is a mistake."
          )
        );
      return;
    }

    if (registration.discord_user_id && registration.discord_user_id !== discordUser.id) {
      res
        .status(200)
        .json(
          interactionResponse(
            "❌ That registration is already linked to a different Discord account. Contact staff for help."
          )
        );
      return;
    }

    const { error: updateError } = await supabase
      .from("registrations")
      .update({
        discord_user_id: discordUser.id,
        discord_username: discordUser.username ?? null,
        discord_verified_at: new Date().toISOString(),
      })
      .eq("email", registration.email);

    if (updateError) {
      if ((updateError as { code?: string }).code === "23505") {
        res
          .status(200)
          .json(
            interactionResponse(
              "❌ This Discord account is already linked to a registration. Contact staff if this is a mistake."
            )
          );
        return;
      }

      throw updateError;
    }

    res.status(200).json(interactionResponse(`✅ Verified: ${registration.first_name} ${registration.last_name}`));
  } catch (error) {
    console.error("verify command error", error);
    res.status(200).json(interactionResponse("An internal error occurred. Please try again later."));
  }
}
