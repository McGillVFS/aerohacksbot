# Render Deployment

## Service type

Deploy this project as a Render `Web Service` (Node runtime).

## Build and start commands

- Build: `npm ci && npm run build`
- Start: `npm run start`
- Health check path: `/api/health`

You can set this up manually in Render or use Blueprint deploy with `render.yaml`.

## Required environment variables

- `DISCORD_PUBLIC_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DISCORD_APP_ID`
- `DISCORD_TOKEN` (or legacy fallback `DISCORD_BOT_TOKEN`)
- optional `DISCORD_GUILD_ID` (defaults to `1440784109034274838` in registration script)

## Discord configuration

After deployment, set the Discord `Interactions Endpoint URL` to:

`https://<your-render-domain>/api/discord/interactions`

Then run command registration locally:

`npm run register:guild`
