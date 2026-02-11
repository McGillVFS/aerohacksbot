import nextEnv from "@next/env";
import { getActionReason, postModLog } from "./discord-action-logger.mjs";
import {
  buildGoLiveSeeds,
  buildPreviewEmbed,
  CHANNEL_PERMISSION_TEMPLATE,
  GO_LIVE_CHANNELS,
  PERMISSION_BITS,
  fetchOfficialSourceSnapshot,
} from "./go-live-content-manifest.mjs";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const DEFAULT_DISCORD_GUILD_ID = "1440784109034274838";
const DEFAULT_VERIFIED_ROLE_NAME = "Attendee";
const DRY_RUN = process.argv.includes("--dry-run");
const PHASE = getArgValue("--phase");
const DISCORD_TOKEN = process.env.DISCORD_TOKEN ?? process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID ?? DEFAULT_DISCORD_GUILD_ID;
const VERIFIED_ROLE_NAME = process.env.VERIFIED_ROLE_NAME ?? DEFAULT_VERIFIED_ROLE_NAME;
const ACTION_REASON = getActionReason(
  PHASE === "finalize"
    ? "Finalize go-live setup by publishing onboarding embeds and applying permissions."
    : "Preview go-live onboarding embeds in staff-only channel."
);

if (!DISCORD_TOKEN) {
  console.error("Missing required env var: DISCORD_TOKEN (or DISCORD_BOT_TOKEN)");
  process.exit(1);
}

if (PHASE !== "preview" && PHASE !== "finalize") {
  console.error('Missing or invalid --phase. Use "--phase preview" or "--phase finalize".');
  process.exit(1);
}

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return null;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    return null;
  }
  return value;
}

function permissionValue(bits) {
  return bits.reduce((acc, bit) => acc + bit, 0n).toString();
}

function extractSeedKey(message) {
  if (!message?.embeds || message.embeds.length === 0) {
    return null;
  }
  for (const embed of message.embeds) {
    const footerText = embed?.footer?.text;
    if (!footerText) continue;
    const match = footerText.match(/\[seed:([^\]]+)\]/);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

async function discordApi(path, { method = "GET", body, expectedStatuses = [200], headers = {} } = {}) {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: {
      Authorization: `Bot ${DISCORD_TOKEN}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!expectedStatuses.includes(response.status)) {
    const errorBody = await response.text();
    throw new Error(`Discord API ${method} ${path} failed (${response.status}): ${errorBody}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function fetchBotUserId() {
  const me = await discordApi("/users/@me");
  return me.id;
}

function buildEmbedPayload(embed) {
  return {
    content: "",
    embeds: [embed],
    allowed_mentions: {
      parse: [],
    },
  };
}

function findExistingSeedMessage(messages, { botUserId, seedKey, legacyTitleMatch }) {
  for (const message of messages) {
    if (message?.author?.id !== botUserId) {
      continue;
    }

    if (extractSeedKey(message) === seedKey) {
      return message;
    }

    if (legacyTitleMatch) {
      const firstTitle = message?.embeds?.[0]?.title;
      if (firstTitle && firstTitle === legacyTitleMatch) {
        return message;
      }
    }
  }
  return null;
}

function ensureRequiredChannelsExist(channels) {
  const requiredChannelIds = new Set([
    GO_LIVE_CHANNELS.staffChat.id,
    GO_LIVE_CHANNELS.modLog.id,
    ...Object.values(GO_LIVE_CHANNELS).map((entry) => entry.id),
  ]);

  const channelIds = new Set(channels.map((channel) => channel.id));
  const missing = [];
  for (const channelId of requiredChannelIds) {
    if (!channelIds.has(channelId)) {
      missing.push(channelId);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required channel IDs: ${missing.join(", ")}`);
  }
}

async function upsertEmbed({
  channelId,
  embed,
  seedKey,
  botUserId,
  legacyTitleMatch = null,
  dryRun,
  messageCache,
}) {
  const payload = buildEmbedPayload(embed);

  if (dryRun) {
    return {
      action: "would_upsert",
      channelId,
      messageId: `dry-run:${seedKey}`,
    };
  }

  if (!messageCache.has(channelId)) {
    const messages = await discordApi(`/channels/${channelId}/messages?limit=100`);
    messageCache.set(channelId, messages);
  }

  const cachedMessages = messageCache.get(channelId) ?? [];
  const existing = findExistingSeedMessage(cachedMessages, {
    botUserId,
    seedKey,
    legacyTitleMatch,
  });

  if (existing) {
    const updated = await discordApi(`/channels/${channelId}/messages/${existing.id}`, {
      method: "PATCH",
      body: payload,
      expectedStatuses: [200],
    });
    messageCache.delete(channelId);
    return {
      action: "updated",
      channelId,
      messageId: updated.id,
    };
  }

  const created = await discordApi(`/channels/${channelId}/messages`, {
    method: "POST",
    body: payload,
    expectedStatuses: [200],
  });
  messageCache.delete(channelId);
  return {
    action: "created",
    channelId,
    messageId: created.id,
  };
}

async function pinMessage({ channelId, messageId, dryRun }) {
  if (dryRun) {
    return { action: "would_pin", channelId, messageId };
  }

  await discordApi(`/channels/${channelId}/pins/${messageId}`, {
    method: "PUT",
    expectedStatuses: [204],
  });

  return { action: "pinned", channelId, messageId };
}

async function deleteRoleOverwrite({ channelId, roleId, dryRun }) {
  if (dryRun) {
    return { action: "would_delete_overwrite", channelId, roleId };
  }

  try {
    await discordApi(`/channels/${channelId}/permissions/${roleId}`, {
      method: "DELETE",
      expectedStatuses: [204],
    });
  } catch (error) {
    const message = String(error);
    if (message.includes("(404)")) {
      return { action: "overwrite_absent", channelId, roleId };
    }
    throw error;
  }

  return { action: "overwrite_deleted", channelId, roleId };
}

async function putRoleOverwrite({ channelId, roleId, allowBits, denyBits, dryRun }) {
  const payload = {
    type: 0,
    allow: permissionValue(allowBits),
    deny: permissionValue(denyBits),
  };

  if (dryRun) {
    return {
      action: "would_put_overwrite",
      channelId,
      roleId,
      allow: payload.allow,
      deny: payload.deny,
    };
  }

  await discordApi(`/channels/${channelId}/permissions/${roleId}`, {
    method: "PUT",
    body: payload,
    expectedStatuses: [204],
  });

  return {
    action: "overwrite_updated",
    channelId,
    roleId,
    allow: payload.allow,
    deny: payload.deny,
  };
}

async function applyPermissionTemplate({ everyoneRoleId, verifiedRoleId, dryRun }) {
  const outputs = [];

  const publicReadAllow = [PERMISSION_BITS.VIEW_CHANNEL, PERMISSION_BITS.READ_MESSAGE_HISTORY];
  const publicReadDeny = [PERMISSION_BITS.SEND_MESSAGES];
  const publicInteractiveAllow = [
    PERMISSION_BITS.VIEW_CHANNEL,
    PERMISSION_BITS.READ_MESSAGE_HISTORY,
    PERMISSION_BITS.SEND_MESSAGES,
    PERMISSION_BITS.USE_APPLICATION_COMMANDS,
  ];

  for (const channelId of CHANNEL_PERMISSION_TEMPLATE.publicReadOnly) {
    outputs.push(
      await putRoleOverwrite({
        channelId,
        roleId: everyoneRoleId,
        allowBits: publicReadAllow,
        denyBits: publicReadDeny,
        dryRun,
      })
    );
    outputs.push(await deleteRoleOverwrite({ channelId, roleId: verifiedRoleId, dryRun }));
  }

  for (const channelId of CHANNEL_PERMISSION_TEMPLATE.publicInteractive) {
    outputs.push(
      await putRoleOverwrite({
        channelId,
        roleId: everyoneRoleId,
        allowBits: publicInteractiveAllow,
        denyBits: [],
        dryRun,
      })
    );
    outputs.push(await deleteRoleOverwrite({ channelId, roleId: verifiedRoleId, dryRun }));
  }

  for (const channelId of CHANNEL_PERMISSION_TEMPLATE.verifiedInteractive) {
    outputs.push(
      await putRoleOverwrite({
        channelId,
        roleId: everyoneRoleId,
        allowBits: [],
        denyBits: [PERMISSION_BITS.VIEW_CHANNEL],
        dryRun,
      })
    );
    outputs.push(
      await putRoleOverwrite({
        channelId,
        roleId: verifiedRoleId,
        allowBits: publicInteractiveAllow,
        denyBits: [],
        dryRun,
      })
    );
  }

  return outputs;
}

function formatOperation(operation) {
  if (operation.action === "created" || operation.action === "updated") {
    return `${operation.action.toUpperCase()} channel=${operation.channelId} message=${operation.messageId}`;
  }
  if (operation.action === "pinned") {
    return `PINNED channel=${operation.channelId} message=${operation.messageId}`;
  }
  if (operation.action === "overwrite_updated") {
    return `PERM channel=${operation.channelId} role=${operation.roleId} allow=${operation.allow} deny=${operation.deny}`;
  }
  if (operation.action === "overwrite_deleted" || operation.action === "overwrite_absent") {
    return `${operation.action.toUpperCase()} channel=${operation.channelId} role=${operation.roleId}`;
  }
  if (operation.action === "would_upsert" || operation.action === "would_pin" || operation.action === "would_put_overwrite") {
    return `DRY-RUN ${JSON.stringify(operation)}`;
  }
  if (operation.action === "would_delete_overwrite") {
    return `DRY-RUN delete_overwrite channel=${operation.channelId} role=${operation.roleId}`;
  }
  return JSON.stringify(operation);
}

async function run() {
  const actionName = PHASE === "preview" ? "go_live_setup_preview" : "go_live_setup_finalize";
  const snapshot = await fetchOfficialSourceSnapshot();
  const seeds = buildGoLiveSeeds(snapshot);
  const operationLog = [];
  const messageCache = new Map();

  const [channels, roles, botUserId] = await Promise.all([
    discordApi(`/guilds/${DISCORD_GUILD_ID}/channels`),
    discordApi(`/guilds/${DISCORD_GUILD_ID}/roles`),
    fetchBotUserId(),
  ]);

  ensureRequiredChannelsExist(channels);

  if (PHASE === "preview") {
    for (const seed of seeds) {
      const previewEmbed = buildPreviewEmbed(seed);
      const previewSeedKey = `go-live-preview:${seed.key}`;
      const upsertResult = await upsertEmbed({
        channelId: GO_LIVE_CHANNELS.staffChat.id,
        embed: previewEmbed,
        seedKey: previewSeedKey,
        botUserId,
        dryRun: DRY_RUN,
        messageCache,
      });
      operationLog.push({
        ...upsertResult,
        targetChannelId: seed.channelId,
      });
    }
  }

  if (PHASE === "finalize") {
    const publishResults = [];
    const pinResults = [];

    for (const seed of seeds) {
      const seedKey = seed.embed.footer.text.match(/\[seed:([^\]]+)\]/)?.[1];
      if (!seedKey) {
        throw new Error(`Embed for ${seed.key} missing deterministic seed key.`);
      }

      const upsertResult = await upsertEmbed({
        channelId: seed.channelId,
        embed: seed.embed,
        seedKey,
        botUserId,
        dryRun: DRY_RUN,
        legacyTitleMatch: seed.legacyTitleMatch ?? null,
        messageCache,
      });
      publishResults.push(upsertResult);
      operationLog.push(upsertResult);

      if (seed.pin) {
        const pinResult = await pinMessage({
          channelId: seed.channelId,
          messageId: upsertResult.messageId,
          dryRun: DRY_RUN,
        });
        pinResults.push(pinResult);
        operationLog.push(pinResult);
      }
    }

    const publishFailures = publishResults.filter((result) => result.action === "error");
    if (publishFailures.length === 0) {
      const everyoneRole = roles.find((role) => role.id === DISCORD_GUILD_ID || role.name === "@everyone");
      const verifiedRole = roles.find((role) => role.name === VERIFIED_ROLE_NAME);

      if (!everyoneRole) {
        throw new Error("Could not resolve @everyone role for permission updates.");
      }
      if (!verifiedRole) {
        throw new Error(`Could not resolve verified role "${VERIFIED_ROLE_NAME}".`);
      }

      const permissionResults = await applyPermissionTemplate({
        everyoneRoleId: everyoneRole.id,
        verifiedRoleId: verifiedRole.id,
        dryRun: DRY_RUN,
      });
      operationLog.push(...permissionResults);
    }
  }

  const summary = `${PHASE} completed with ${operationLog.length} operation(s).${DRY_RUN ? " (dry-run)" : ""}`;
  const detailLines = operationLog.map(formatOperation).slice(0, 30);

  if (!DRY_RUN) {
    await postModLog({
      token: DISCORD_TOKEN,
      action: actionName,
      reason: ACTION_REASON,
      summary,
      details: detailLines,
      status: "success",
      guildId: DISCORD_GUILD_ID,
    });
  }

  console.log(summary);
  for (const line of detailLines) {
    console.log(line);
  }
}

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`go-live setup failed: ${message}`);

  if (!DRY_RUN) {
    try {
      await postModLog({
        token: DISCORD_TOKEN,
        action: PHASE === "finalize" ? "go_live_setup_finalize" : "go_live_setup_preview",
        reason: ACTION_REASON,
        summary: `Go-live ${PHASE} failed.`,
        details: [message],
        status: "failure",
        guildId: DISCORD_GUILD_ID,
      });
    } catch (logError) {
      console.error("Additionally failed to write mod-log entry:", logError);
    }
  }

  process.exit(1);
}
