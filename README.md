# AeroHacks Discord Verify Bot (HTTP Interactions)

Discord interactions bot built with Next.js Pages API routes, configured for Render deployment.

## Commands

- `/verify email:<email>`
- `/status`
- `/find_teammates [interest]`
- `/help`

## Admin scripts

- `npm run register:guild [-- --reason "<why>"]`
- `npm run post:rules [-- --reason "<why>"] [-- --dry-run]`
- `npm run rename:channels [-- --reason "<why>"] [-- --dry-run]`
- `npm run go-live:setup -- --phase preview [-- --reason "<why>"] [-- --dry-run]`
- `npm run go-live:setup -- --phase finalize [-- --reason "<why>"] [-- --dry-run]`

These scripts automatically write an audit entry to `#mod-log` with:

- action name
- why the action was taken
- a summary of what changed
- success/failure status

### Go-live rollout phases

- `preview`:
  - posts embed previews to `#💬│staff-chat` only
  - does not post in public channels
  - does not change channel permissions
- `finalize`:
  - upserts embed posts in target onboarding channels
  - pins required posts
  - applies hybrid permission template last

All seeded onboarding messages are embed-only payloads (`content: ""`, `embeds`, `allowed_mentions.parse: []`).

## Endpoint

- `POST /api/discord/interactions`
- `GET /api/health`
- Route file: `pages/api/discord/interactions.ts`

## Local setup

1. Install dependencies:
   `npm install`
2. Copy env vars from `.env.example`.
3. Run:
   `npm run dev`

## Required environment variables

- `DISCORD_PUBLIC_KEY` (or legacy `PUBLIC_KEY`)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (or legacy `SUPABASE_KEY`)
- `DISCORD_APP_ID` (for command registration script)
- `DISCORD_TOKEN` (for command registration script and role assignment; legacy fallback `DISCORD_BOT_TOKEN` also supported)
- `DISCORD_GUILD_ID` (optional; defaults to `1440784109034274838` for `npm run register:guild`)

## Deploy on Render

1. Create a new Render `Web Service` from this repository, or use Blueprint deploy with `render.yaml`.
2. Use build command:
   `npm ci && npm run build`
3. Use start command:
   `npm run start`
4. Set health check path:
   `/api/health`
5. Set required environment variables in Render (same list as above).
6. After deploy, set Discord `Interactions Endpoint URL` to:
   `https://<your-render-domain>/api/discord/interactions`

## Troubleshooting

- If `npm run register:guild` reports missing variables, confirm `.env.local` or `.env` contains `DISCORD_APP_ID` and `DISCORD_TOKEN` (or `DISCORD_BOT_TOKEN`).
- If `/api/discord/interactions` returns HTTP 500, check server logs for missing required environment variable names and set them before retrying.

## Database migration

Apply:

- `supabase/migrations/20260207_add_discord_verification_columns.sql`

## Discord setup

See:

- `docs/discord-interactions-setup.md`
- `docs/render-deployment.md`
