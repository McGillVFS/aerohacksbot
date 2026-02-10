# Discord API Checklist

## Table of Contents
- Command registration checklist
- Interaction endpoint checklist
- OAuth2 and install checklist
- Quick troubleshooting checklist

## Command registration checklist

1. Choose scope:
   - Guild endpoint: `/applications/{application.id}/guilds/{guild.id}/commands`
   - Global endpoint: `/applications/{application.id}/commands`
2. Use `PUT` for full replacement when syncing a command set.
3. Start with guild scope during development for near-immediate updates.
4. Verify required fields:
   - `name` (lowercase, stable)
   - `description`
   - `type`
   - `options` (when needed)
5. Confirm bot token has permission to manage application commands.

## Interaction endpoint checklist

1. Configure endpoint URL in Discord Developer Portal.
2. Handle validation PING (`type: 1`) by returning PONG (`type: 1`).
3. Verify each request signature before parsing business logic:
   - Concatenate timestamp + raw body bytes.
   - Verify against app public key (Ed25519).
4. Reject invalid signatures with HTTP 401.
5. Return valid interaction callback types (`4`, `5`, etc.) and keep ephemeral flags explicit when needed.

## OAuth2 and install checklist

1. Include minimum scopes for purpose:
   - `bot`
   - `applications.commands`
2. Include only required permissions bitset for least privilege.
3. Confirm app is installed in the expected server/environment.
4. Re-check role hierarchy if role assignment or moderation actions fail.

## Quick troubleshooting checklist

1. Command missing:
   - Confirm scope (guild/global) and IDs.
   - Re-register command payload.
2. Endpoint rejected:
   - Confirm public key and raw-body signature verification.
   - Ensure reverse proxy does not mutate request body.
3. App not responding:
   - Check interaction response type.
   - Use deferred response for longer-running operations.
4. Works locally but not deployed:
   - Compare environment variable names and values.
   - Confirm server runtime has access to secret vars.
