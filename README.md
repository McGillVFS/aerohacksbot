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

## Database migration

Apply:

- `supabase/migrations/20260207_add_discord_verification_columns.sql`

## Discord + Vercel setup

See:

- `docs/discord-interactions-setup.md`
