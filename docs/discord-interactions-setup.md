# Discord Interactions Setup

## 1) Register `/verify` command with optional `email`

Use Discord's commands API. For fast testing, register guild-scoped commands first.

`PUT https://discord.com/api/v10/applications/{APP_ID}/guilds/{GUILD_ID}/commands`

Request body:

```json
[
  {
    "name": "verify",
    "description": "Verify your hackathon registration.",
    "type": 1,
    "options": [
      {
        "type": 3,
        "name": "email",
        "description": "Your registration email.",
        "required": false
      }
    ]
  }
]
```

For global commands, replace the URL with:

`PUT https://discord.com/api/v10/applications/{APP_ID}/commands`

### Fast path for testing (guild-specific)

This repo includes a script that registers the command directly to a guild:

1. Set env vars:
   - `DISCORD_APP_ID`
   - `DISCORD_BOT_TOKEN`
   - optional `DISCORD_GUILD_ID` (defaults to `1440784109034274838`)
2. Run:
   `npm run register:guild`

Guild commands update almost immediately, unlike global commands.

## 2) Configure Interaction Endpoint URL

In Discord Developer Portal:

1. Open your application.
2. Go to `General Information`.
3. Set `Interactions Endpoint URL` to:
   `https://<your-vercel-domain>/api/discord/interactions`

Discord validates the endpoint with a ping request (`type: 1`), and this route responds with `{"type":1}`.

## 3) Configure Vercel environment variables

Set these in Vercel Project Settings -> Environment Variables:

- `DISCORD_PUBLIC_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

`SUPABASE_SERVICE_ROLE_KEY` must remain server-only and must never be exposed in client bundles.
