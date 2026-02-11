# Platform Checklists

Use only the checklist matching the chosen integration path.

## Slack Events API Checklist

1. Create Slack app and enable Events API.
2. Configure request URL to the Render web endpoint.
3. Verify URL challenge handling and signing secret validation.
4. Subscribe only to required bot events.
5. Acknowledge events immediately; move AI work to async jobs.
6. Send responses back through Slack Web API using bot token.
7. Add idempotency around Slack event IDs for retries.

## Slack Socket Mode Checklist

1. Enable Socket Mode and provision app-level token.
2. Run persistent websocket client in Render Background Worker.
3. Implement reconnect and heartbeat handling.
4. Acknowledge socket envelopes quickly.
5. Offload heavy AI work to async queue when latency is unpredictable.
6. Post final responses with Slack Web API.

## Discord Interactions Checklist

1. Configure interactions endpoint in Discord Developer Portal.
2. Verify Ed25519 signatures for every inbound request.
3. Return `PONG` for validation pings.
4. Acknowledge within timing constraints; defer when work is long-running.
5. Process deferred work asynchronously and edit/follow up through Discord APIs.
6. Enforce idempotency for repeated interaction payloads.

## Discord Gateway Checklist

1. Run gateway bot client in Render Background Worker.
2. Implement identify, heartbeat, resume, and reconnect logic.
3. Handle intent configuration and privileged intent requirements.
4. Process inbound gateway events and enqueue expensive AI tasks.
5. Send outbound messages through Discord REST API with rate-limit handling.

## Security Checklist

1. Keep tokens/secrets in Render environment variables only.
2. Never log raw secrets, auth headers, or full signed payloads.
3. Validate all inbound signatures before enqueueing work.
4. Restrict outbound scopes/permissions to minimum required.

## Verification Checklist

1. Confirm test event reaches ingress or worker successfully.
2. Confirm ack path is fast and stable under retry conditions.
3. Confirm async job posts response to expected channel/thread.
4. Confirm reconnect behavior after worker restart.
5. Confirm failed jobs are observable and retry policy behaves as expected.

