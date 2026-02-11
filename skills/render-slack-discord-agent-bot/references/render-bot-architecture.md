# Render Bot Architecture

Use this file to select infrastructure shape before coding.

## Decision Matrix

| Platform path | Render service pattern | Notes |
| --- | --- | --- |
| Slack Events API | Web Service (+ optional queue + worker) | Public HTTPS endpoint receives events and slash commands. |
| Slack Socket Mode | Background Worker (+ optional queue) | No public webhook required; maintain websocket connection. |
| Discord Interactions | Web Service (+ optional queue + worker) | Public HTTPS endpoint for interaction callbacks. |
| Discord Gateway | Background Worker (+ optional queue) | Maintain long-lived gateway websocket and heartbeat handling. |

## Recommended Service Split

1. `ingress-web` (Web Service)
   - Handle webhook verification and minimal routing.
   - Acknowledge quickly.
   - Enqueue AI work.
2. `agent-worker` (Background Worker)
   - Execute model/tool workflows.
   - Call Slack/Discord APIs to send final messages.
3. `queue` (Redis)
   - Buffer and retry jobs.
4. `state-db` (Postgres or existing DB)
   - Store threads, conversation memory, idempotency keys, and processing status.

## Event Handling Pattern

1. Verify request authenticity at ingress.
2. Parse platform event and normalize into internal job schema.
3. Persist idempotency key before enqueue.
4. Enqueue job and return immediate ack.
5. Worker pulls job, loads conversation context, runs AI logic, posts response.
6. Persist completion status and latency/error metadata.

## Operational Guardrails

1. Keep websocket workers isolated from HTTP ingress for easier scaling.
2. Use backoff + jitter on reconnect loops and outbound API retries.
3. Emit structured logs with `event_id`, `job_id`, and `channel_id` correlation.
4. Configure health checks on web services and lightweight heartbeat telemetry for workers.
5. Use dead-letter handling for permanently failing jobs.

