# AeroHacks Discord Verify Bot (HTTP Interactions)

Serverless Discord Interactions bot built with Next.js Pages API routes for Vercel.

## Endpoint

- `POST /api/discord/interactions`
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
- `DISCORD_TOKEN` (for command registration script and role assignment)
- `DISCORD_GUILD_ID` (optional; defaults to `1440784109034274838` for `npm run register:guild`)

## Troubleshooting

- If `npm run register:guild` reports missing variables, confirm `.env.local` or `.env` contains `DISCORD_APP_ID` and `DISCORD_TOKEN`.
- If `/api/discord/interactions` returns HTTP 500, check server logs for missing required environment variable names and set them before retrying.

## Database migration

Apply:

- `supabase/migrations/20260207_add_discord_verification_columns.sql`

## Discord + Vercel setup

See:

- `docs/discord-interactions-setup.md`
