const DEFAULT_DISCORD_GUILD_ID = "1440784109034274838";
const DEFAULT_MOD_LOG_CHANNEL_ID = "1440784110200160398";

function truncate(value, maxLength) {
  if (!value) {
    return "";
  }
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function stringifyDetails(details) {
  if (!details || details.length === 0) {
    return "_None_";
  }
  return truncate(details.join("\n"), 1024);
}

export function getActionReason(defaultReason = "No reason provided.") {
  const reasonIndex = process.argv.indexOf("--reason");
  if (reasonIndex >= 0) {
    const reasonValue = process.argv[reasonIndex + 1];
    if (reasonValue && !reasonValue.startsWith("--")) {
      return reasonValue;
    }
  }
  return process.env.ACTION_REASON ?? defaultReason;
}

export async function postModLog({
  token,
  action,
  reason,
  summary,
  details = [],
  status = "success",
  guildId = process.env.DISCORD_GUILD_ID ?? DEFAULT_DISCORD_GUILD_ID,
  channelId = process.env.MOD_LOG_CHANNEL_ID ?? DEFAULT_MOD_LOG_CHANNEL_ID,
}) {
  if (!token) {
    throw new Error("postModLog requires a Discord bot token.");
  }

  const statusEmoji = status === "success" ? "✅" : "❌";
  const payload = {
    content: "",
    embeds: [
      {
        title: `${statusEmoji} Admin Action Logged`,
        color: status === "success" ? 5763719 : 15548997,
        fields: [
          {
            name: "Action",
            value: truncate(action, 256),
          },
          {
            name: "Why",
            value: truncate(reason || "No reason provided.", 1024),
          },
          {
            name: "Summary",
            value: truncate(summary, 1024),
          },
          {
            name: "Details",
            value: stringifyDetails(details),
          },
        ],
        footer: {
          text: `Guild ${guildId} • Logged by Codex`,
        },
        timestamp: new Date().toISOString(),
      },
    ],
    allowed_mentions: {
      parse: [],
    },
  };

  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to post mod-log entry (${response.status}): ${body}`);
  }

  return response.json();
}
