import nextEnv from "@next/env";
import { getActionReason, postModLog } from "./discord-action-logger.mjs";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const DEFAULT_DISCORD_GUILD_ID = "1440784109034274838";
const DISCORD_TOKEN = process.env.DISCORD_TOKEN ?? process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID ?? DEFAULT_DISCORD_GUILD_ID;
const IS_DRY_RUN = process.argv.includes("--dry-run");
const ACTION_REASON = getActionReason("Apply standardized emoji channel naming.");

if (!DISCORD_TOKEN) {
  console.error("Missing required env var: DISCORD_TOKEN (or DISCORD_BOT_TOKEN)");
  process.exit(1);
}

const updates = [
  ["1440784110200160390", "📢│announcements"],
  ["1440784110200160391", "👋│welcome"],
  ["1440784110200160392", "📝│rules"],
  ["1440784110200160393", "❓│faq-and-resources"],
  ["1440784110200160394", "🌱│getting-started"],
  ["1440784110200160396", "💬│staff-chat"],
  ["1440784110200160397", "🎖│judging"],
  ["1440784110200160398", "🛡│mod-log"],
  ["1440784110434914334", "📣 Staff War Room"],
  ["1440784110434914336", "🔰│introductions"],
  ["1440784110434914337", "💬│general"],
  ["1440784110434914338", "❓│event-questions"],
  ["1440784110434914340", "🏛 Main Stage"],
  ["1440784110434914339", "☕️ Lounge"],
  ["1440784110434914341", "🎙 Breakout Room"],
  ["1440784110434914343", "💬│sponsor-1"],
  ["1440784110757871627", "👾│off-topic"],
  ["1440784110757871628", "🎒│workshop"],
  ["1440784110757871629", "🎙 workshop"],
  ["1440784110757871631", "👤│whois"],
  ["1440784110757871632", "✋│get-a-mentor"],
  ["1440784110757871633", "💬│mentor-room"],
  ["1440784110757871634", "🎙 Mentor Room"],
];

if (IS_DRY_RUN) {
  console.log(JSON.stringify({ guildId: DISCORD_GUILD_ID, updates }, null, 2));
  process.exit(0);
}

const results = [];
for (const [channelId, name] of updates) {
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bot ${DISCORD_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  });

  if (!response.ok) {
    const body = await response.text();
    const failureMessage = `FAIL ${channelId} -> ${name}: ${response.status} ${body}`;
    results.push(failureMessage);
    console.error(failureMessage);
    continue;
  }

  const updated = await response.json();
  const successMessage = `OK ${channelId} -> ${updated.name}`;
  results.push(successMessage);
  console.log(successMessage);
}

const failedCount = results.filter((line) => line.startsWith("FAIL")).length;
const successCount = results.length - failedCount;
const status = failedCount > 0 ? "failure" : "success";

await postModLog({
  token: DISCORD_TOKEN,
  action: "rename_channels_with_emojis",
  reason: ACTION_REASON,
  summary: `Renamed ${successCount}/${updates.length} configured channels.${failedCount > 0 ? ` ${failedCount} failed.` : ""}`,
  details: results.slice(0, 20),
  status,
  guildId: DISCORD_GUILD_ID,
});

if (failedCount > 0) {
  process.exit(1);
}
