import nextEnv from "@next/env";
import { getActionReason, postModLog } from "./discord-action-logger.mjs";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const DEFAULT_DISCORD_GUILD_ID = "1440784109034274838";
const DEFAULT_RULES_CHANNEL_ID = "1440784110200160392";
const DISCORD_TOKEN = process.env.DISCORD_TOKEN ?? process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID ?? DEFAULT_DISCORD_GUILD_ID;
const RULES_CHANNEL_ID = process.env.RULES_CHANNEL_ID ?? DEFAULT_RULES_CHANNEL_ID;
const IS_DRY_RUN = process.argv.includes("--dry-run");
const ACTION_REASON = getActionReason("Publish or refresh the MLH-compliant rules embed.");

if (!DISCORD_TOKEN) {
  console.error("Missing required env var: DISCORD_TOKEN (or DISCORD_BOT_TOKEN)");
  process.exit(1);
}

const payload = {
  content: "",
  embeds: [
    {
      title: "✈️ McGill AeroHacks Discord Rules",
      description:
        "Welcome to the official McGill AeroHacks Discord server.\n\n**TL;DR:** Be respectful, be professional, and follow the MLH Code of Conduct.",
      color: 3447003,
      fields: [
        {
          name: "1) Code of Conduct (MLH)",
          value:
            "By participating, you agree to the MLH Code of Conduct. We are committed to a harassment-free experience for everyone, and we maintain zero tolerance for harassment in any form.\nPolicy: https://github.com/MLH/mlh-policies/blob/main/code-of-conduct.md",
        },
        {
          name: "2) Respect & Professionalism",
          value:
            "Be respectful and constructive with participants, mentors, judges, and organizers. No NSFW, violent, or disturbing content. Use inclusive language and communicate professionally.",
        },
        {
          name: "3) Server Etiquette",
          value:
            "No spam, scams, or unsolicited advertising. Keep discussions in the correct channels (`#event-questions`, `#find-a-mentor`, `#general`, `#introductions`, `#off-topic`). Respect privacy: no doxxing or sharing personal information without consent.",
        },
        {
          name: "4) Bot & Voice Usage",
          value:
            "Use bot commands in `#bot-commands`. In voice channels, use push-to-talk when you have background noise and avoid disruptive audio.",
        },
        {
          name: "5) Enforcement",
          value:
            "Minor issues may receive warnings. Serious or repeated violations, especially CoC violations, can result in immediate server removal and hackathon disqualification. Organizer decisions are final.",
        },
        {
          name: "🚨 Reporting & Safety",
          value:
            "Report concerns immediately to `@Event Staff`.\nMLH report form: https://mlh.io/report\nMLH Emergency Hotline (24/7): +1 (409) 202-6060",
        },
      ],
      footer: {
        text: "By participating, you agree to these rules and MLH policies.",
      },
    },
  ],
  allowed_mentions: {
    parse: [],
  },
};

function validateEmbedMessage(messagePayload) {
  const embed = messagePayload.embeds?.[0];
  if (!embed) {
    throw new Error("Payload must include exactly one embed.");
  }
  if ((messagePayload.embeds?.length ?? 0) !== 1) {
    throw new Error("Payload must include exactly one embed.");
  }
  if (!Array.isArray(messagePayload.allowed_mentions?.parse)) {
    throw new Error("allowed_mentions.parse must be an array.");
  }
  if (messagePayload.allowed_mentions.parse.length !== 0) {
    throw new Error("allowed_mentions.parse must be empty.");
  }

  const forbiddenChannels = ["#mentors", "#team-building"];
  const payloadString = JSON.stringify(messagePayload);
  for (const channel of forbiddenChannels) {
    if (payloadString.includes(channel)) {
      throw new Error(`Payload references invalid channel name: ${channel}`);
    }
  }

  const requiredStrings = [
    "https://github.com/MLH/mlh-policies/blob/main/code-of-conduct.md",
    "https://mlh.io/report",
    "+1 (409) 202-6060",
  ];
  for (const value of requiredStrings) {
    if (!payloadString.includes(value)) {
      throw new Error(`Payload is missing required content: ${value}`);
    }
  }

  if ((embed.title?.length ?? 0) > 256) {
    throw new Error("Embed title exceeds 256 characters.");
  }
  if ((embed.description?.length ?? 0) > 4096) {
    throw new Error("Embed description exceeds 4096 characters.");
  }
  if ((embed.footer?.text?.length ?? 0) > 2048) {
    throw new Error("Embed footer text exceeds 2048 characters.");
  }
  if ((embed.fields?.length ?? 0) > 25) {
    throw new Error("Embed field count exceeds 25.");
  }

  let totalChars = 0;
  totalChars += embed.title?.length ?? 0;
  totalChars += embed.description?.length ?? 0;
  totalChars += embed.footer?.text?.length ?? 0;
  for (const field of embed.fields ?? []) {
    if ((field.name?.length ?? 0) > 256) {
      throw new Error(`Embed field name exceeds 256 characters: ${field.name}`);
    }
    if ((field.value?.length ?? 0) > 1024) {
      throw new Error(`Embed field value exceeds 1024 characters: ${field.name}`);
    }
    totalChars += field.name?.length ?? 0;
    totalChars += field.value?.length ?? 0;
  }
  if (totalChars > 6000) {
    throw new Error(`Embed total character count exceeds 6000 (${totalChars}).`);
  }
}

validateEmbedMessage(payload);

if (IS_DRY_RUN) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const response = await fetch(`https://discord.com/api/v10/channels/${RULES_CHANNEL_ID}/messages`, {
  method: "POST",
  headers: {
    Authorization: `Bot ${DISCORD_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});

if (!response.ok) {
  const body = await response.text();
  try {
    await postModLog({
      token: DISCORD_TOKEN,
      action: "post_rules_embed",
      reason: ACTION_REASON,
      summary: `Failed to post rules embed in <#${RULES_CHANNEL_ID}>.`,
      details: [`Discord API error ${response.status}: ${body}`],
      status: "failure",
      guildId: DISCORD_GUILD_ID,
    });
  } catch (logError) {
    console.error("Additionally failed to write mod-log entry:", logError);
  }
  console.error(`Failed to post rules embed (${response.status}): ${body}`);
  process.exit(1);
}

const message = await response.json();
await postModLog({
  token: DISCORD_TOKEN,
  action: "post_rules_embed",
  reason: ACTION_REASON,
  summary: `Posted rules embed in <#${RULES_CHANNEL_ID}>.`,
  details: [
    `Message ID: ${message.id}`,
    "Validated payload structure, required MLH links, and Discord embed limits before posting.",
  ],
  status: "success",
  guildId: DISCORD_GUILD_ID,
});

console.log(
  `Posted rules embed to channel ${RULES_CHANNEL_ID}: https://discord.com/channels/${DISCORD_GUILD_ID}/${RULES_CHANNEL_ID}/${message.id}`
);
