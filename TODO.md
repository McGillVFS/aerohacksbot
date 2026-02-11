# Discord Verify Bot Checklist

## Current command behavior

- `/verify` requires `email`.
- `/status` returns current verification details.
- `/find_teammates [interest]` returns ranked teammates for verified users.
- `/help` returns command guidance.
- Command registration script (`npm run register:guild`) auto-loads `.env.local`/`.env`.
- `DISCORD_GUILD_ID` is optional for registration and defaults to `1440784109034274838`.

## Required environment variables

- `DISCORD_PUBLIC_KEY` (or legacy `PUBLIC_KEY`)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (or legacy `SUPABASE_KEY`)
- `DISCORD_APP_ID`
- `DISCORD_TOKEN` (or legacy `DISCORD_BOT_TOKEN`)
- `DISCORD_GUILD_ID` (optional)

## Remaining manual verification steps

1. Run `npm run register:guild` and confirm Discord returns `/verify`.
2. Ensure the bot invite includes `applications.commands`.
3. Deploy on Render (`npm ci && npm run build`, `npm run start`, health path `/api/health`).
4. Point Discord `Interactions Endpoint URL` to `https://<your-render-domain>/api/discord/interactions`.
5. With valid Supabase credentials configured, run `/verify email:<registered_email>` in Discord.
6. Confirm registration linking succeeds and expected roles are assigned.
