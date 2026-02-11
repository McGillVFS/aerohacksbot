import nextEnv from "@next/env";
import { getActionReason, postModLog } from "./discord-action-logger.mjs";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const DEFAULT_DISCORD_GUILD_ID = "1440784109034274838";
const DISCORD_APP_ID = process.env.DISCORD_APP_ID;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN ?? process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID ?? DEFAULT_DISCORD_GUILD_ID;
const ACTION_REASON = getActionReason("Register or refresh guild slash commands.");

if (!DISCORD_APP_ID || !DISCORD_TOKEN) {
  console.error("Missing required env vars: DISCORD_APP_ID and DISCORD_TOKEN (or DISCORD_BOT_TOKEN)");
  process.exit(1);
}

const commands = [
  {
    name: "verify",
    description: "Verify your hackathon registration.",
    type: 1,
    options: [
      {
        type: 3,
        name: "email",
        description: "Your registration email.",
        required: true,
      },
    ],
  },
  {
    name: "status",
    description: "Check your verification status.",
    type: 1,
  },
  {
    name: "find_teammates",
    description: "Find potential teammates looking for a team.",
    type: 1,
    options: [
      {
        type: 3,
        name: "interest",
        description: "Optional keyword to filter teammate matches.",
        required: false,
      },
    ],
  },
  {
    name: "help",
    description: "Show bot command help.",
    type: 1,
  },
];

const url = `https://discord.com/api/v10/applications/${DISCORD_APP_ID}/guilds/${DISCORD_GUILD_ID}/commands`;

const response = await fetch(url, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${DISCORD_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(commands),
});

if (!response.ok) {
  const body = await response.text();
  try {
    await postModLog({
      token: DISCORD_TOKEN,
      action: "register_guild_commands",
      reason: ACTION_REASON,
      summary: `Failed to register slash commands for guild ${DISCORD_GUILD_ID}.`,
      details: [`Discord API error ${response.status}: ${body}`],
      status: "failure",
      guildId: DISCORD_GUILD_ID,
    });
  } catch (logError) {
    console.error("Additionally failed to write mod-log entry:", logError);
  }
  console.error(`Failed to register guild commands (${response.status}): ${body}`);
  process.exit(1);
}

const registered = await response.json();
await postModLog({
  token: DISCORD_TOKEN,
  action: "register_guild_commands",
  reason: ACTION_REASON,
  summary: `Registered ${registered.length} slash command(s) for guild ${DISCORD_GUILD_ID}.`,
  details: registered.map((cmd) => `/${cmd.name}`),
  status: "success",
  guildId: DISCORD_GUILD_ID,
});

console.log(
  `Registered ${registered.length} guild command(s) for guild ${DISCORD_GUILD_ID}: ${registered
    .map((cmd) => `/${cmd.name}`)
    .join(", ")}`
);
