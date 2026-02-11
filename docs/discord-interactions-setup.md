# Discord Interactions Setup

## 1) Register slash commands

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
        "required": true
      }
    ]
  },
  {
    "name": "status",
    "description": "Check your verification status.",
    "type": 1
  },
  {
    "name": "find_teammates",
    "description": "Find potential teammates looking for a team.",
    "type": 1,
    "options": [
      {
        "type": 3,
        "name": "interest",
        "description": "Optional keyword to filter teammate matches.",
        "required": false
      }
    ]
  },
  {
    "name": "help",
    "description": "Show bot command help.",
    "type": 1
  }
]
```

For global commands, replace the URL with:

`PUT https://discord.com/api/v10/applications/{APP_ID}/commands`

### Fast path for testing (guild-specific)

This repo includes a script that registers the command directly to a guild:

1. Set env vars in `.env.local`, `.env`, or your shell:
   - `DISCORD_APP_ID`
   - `DISCORD_TOKEN` (legacy fallback `DISCORD_BOT_TOKEN` is also accepted)
   - optional `DISCORD_GUILD_ID` (defaults to `1440784109034274838`)
2. Run:
   `npm run register:guild`

The script auto-loads `.env.local` and `.env`, so manual `source .env.local` is not required.

Guild commands update almost immediately, unlike global commands.

## 2) Configure Interaction Endpoint URL

In Discord Developer Portal:

1. Open your application.
2. Go to `General Information`.
3. Set `Interactions Endpoint URL` to:
   `https://<your-render-domain>/api/discord/interactions`

Discord validates the endpoint with a ping request (`type: 1`), and this route responds with `{"type":1}`.

## 3) Configure Render service

Create a Render `Web Service` with:

1. Build command:
   `npm ci && npm run build`
2. Start command:
   `npm run start`
3. Health check path:
   `/api/health`
4. Environment variables:
   - `DISCORD_PUBLIC_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `DISCORD_APP_ID`
   - `DISCORD_TOKEN`
   - optional `DISCORD_GUILD_ID`

This repo includes `render.yaml` for Blueprint deploys with the same configuration.

`SUPABASE_SERVICE_ROLE_KEY` must remain server-only and must never be exposed in client bundles.
