---
name: discord-developer-workflows
description: Build, debug, and operate Discord applications using the official Discord Developer Portal and REST API patterns. Use when Codex needs to create or update slash commands, configure interaction endpoints, verify Discord request signatures, handle interaction responses, manage OAuth/install scopes, or troubleshoot Discord app setup and permission issues.
---

# Discord Developer Workflows

Implement Discord app work with the official docs as source of truth:
- Intro: https://discord.com/developers/docs/intro
- Interactions: https://discord.com/developers/docs/interactions/receiving-and-responding
- Application Commands: https://discord.com/developers/docs/interactions/application-commands
- OAuth2 scopes/permissions: https://discord.com/developers/docs/topics/oauth2

## Workflow Decision Tree

1. Identify user goal:
   - Register or update slash commands
   - Configure webhook interactions endpoint
   - Implement interaction handling in server code
   - Troubleshoot permissions, install scopes, or command visibility
2. Read `references/discord-api-checklist.md` and select the matching section.
3. Execute only the minimal path needed; avoid broad refactors.
4. Validate with a concrete check:
   - Command appears in target guild/global scope
   - Endpoint passes Discord PING validation
   - Signature verification rejects tampered requests
   - Interaction response meets Discord timing/response rules

## Core Procedures

### Register Slash Commands

1. Prefer guild-scoped command registration for fast iteration.
2. Use `scripts/register_slash_command.py` for deterministic REST registration.
3. Switch to global registration only when behavior is final.
4. Confirm final command JSON includes stable `name`, `description`, and option schema.

### Implement Interaction Endpoint

1. Disable body re-parsing when framework supports raw request access.
2. Verify Ed25519 signature using `X-Signature-Ed25519` and `X-Signature-Timestamp`.
3. Return PONG (`type: 1`) for PING requests.
4. Return deferred responses when work may exceed immediate response window.
5. Keep secrets server-only; never expose bot token or signing key to client bundles.

### Troubleshoot Install and Permissions

1. Check app install scopes and bot permissions first.
2. Confirm command scope target (guild vs global) before code changes.
3. Validate channel/role command permissions in server settings.
4. Confirm the app is present in the expected server and environment.

## Project Integration Pattern

When a repository already contains Discord setup docs or scripts:
1. Reuse existing files and conventions before introducing new wrappers.
2. Keep environment variable names consistent with existing code.
3. Add the smallest possible change to preserve deploy reliability.
