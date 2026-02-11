---
name: render-slack-discord-agent-bot
description: Design, implement, deploy, and operate AI agents as Slack or Discord bots on Render. Use when Codex needs to choose between webhook and websocket bot architectures, configure Slack Events API or Socket Mode, implement Discord interactions or gateway workers, add async job processing, persist conversation state, and harden production bot operations on Render.
---

# Render Slack/Discord Agent Bot

Use this skill to implement production-ready Slack or Discord bot integrations for AI agents deployed on Render.

Primary source pattern:
- https://render.com/articles/how-do-i-integrate-my-ai-agent-with-slack-or-discord-as-a-bot

Use official platform docs as protocol source of truth:
- Slack: https://api.slack.com/
- Discord: https://discord.com/developers/docs/intro

## Workflow

1. Identify platform and interaction model:
   - Slack via Events API (incoming HTTP webhooks)
   - Slack via Socket Mode (persistent websocket)
   - Discord via Interactions (incoming HTTP webhooks)
   - Discord via Gateway (persistent websocket)
2. Read `references/render-bot-architecture.md` and choose the matching deploy topology.
3. Read `references/platform-checklists.md` and implement only the matching platform checklist.
4. Implement fast acknowledgment + async processing:
   - Acknowledge inbound requests immediately.
   - Queue long-running AI work for background processing.
5. Persist durable state:
   - Store conversation/session context and idempotency keys in a database.
   - Store ephemeral rate-limit and retry state in Redis when needed.
6. Deploy and validate on Render:
   - Separate web ingress from long-lived workers when required.
   - Validate end-to-end with real platform test events.
7. Add operations guardrails:
   - Retries with backoff
   - Dead-letter or failed-job handling
   - Structured logs and traceable correlation IDs

## Render Topology Rules

1. Use a Render Web Service when receiving HTTP events/webhooks.
2. Use a Render Background Worker for long-lived websocket connections or heavy async execution.
3. Use a queue between ingress and inference/business logic to avoid timeouts.
4. Keep bot secrets and signing keys in Render environment variables only.
5. Keep webhook verification and signature checks at ingress before enqueuing work.

## Implementation Constraints

1. Keep protocol handling minimal and deterministic at ingress.
2. Enforce idempotency for retried inbound events.
3. Treat outbound platform API calls as retryable and rate-limited.
4. Keep user-visible response paths resilient under cold starts and reconnect events.
5. Prefer smallest change sets in repositories with existing bot wiring.

## Validation Checklist

1. Verify webhook signature validation passes for valid requests and fails for tampered ones.
2. Verify inbound events are acknowledged within platform timing limits.
3. Verify queued jobs execute and post responses back to the originating channel/thread.
4. Verify worker reconnect behavior for websocket-based integrations.
5. Verify secrets are not exposed in client bundles, logs, or responses.

