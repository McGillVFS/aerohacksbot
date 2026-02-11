# Discord Verify Bot Checklist

## Current command behavior

- `/verify` requires `email`.
- Command registration script (`npm run register:guild`) auto-loads `.env.local`/`.env`.
- `DISCORD_GUILD_ID` is optional for registration and defaults to `1440784109034274838`.

## Required environment variables

- `DISCORD_PUBLIC_KEY` (or legacy `PUBLIC_KEY`)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (or legacy `SUPABASE_KEY`)
- `DISCORD_APP_ID`
- `DISCORD_TOKEN`
- `DISCORD_GUILD_ID` (optional)

## Remaining manual verification steps

1. Run `npm run register:guild` and confirm Discord returns `/verify`.
2. Ensure the bot invite includes `applications.commands`.
3. With valid Supabase credentials configured, run `/verify email:<registered_email>` in Discord.
4. Confirm registration linking succeeds and expected roles are assigned.
