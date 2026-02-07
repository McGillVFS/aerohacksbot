# Slash Command Troubleshooting

Based on a review of the codebase, here are the likely reasons why the slash commands are not appearing on Discord and the recommended steps to resolve the issue.

### 1. Command Registration

The slash commands need to be registered with Discord before they can appear.

- **Action:** Run the command `npm run register:guild` in your terminal.
- **Check for Errors:** Make sure the script runs without any errors. If it succeeds, it will print a message like `Registered 1 guild command(s) for guild <your_guild_id>: /verify`.

### 2. Environment Variables

The command registration script and the interaction handler rely on environment variables. These need to be set correctly in your Vercel project.

- **Action:** Go to your Vercel project settings and ensure the following environment variables are set:
    - `DISCORD_APP_ID`: Your Discord application's ID.
    - `DISCORD_BOT_TOKEN`: Your Discord bot's token.
    - `DISCORD_GUILD_ID`: The ID of the Discord server you want to add the command to.
    - `DISCORD_PUBLIC_KEY`: Your Discord application's public key.
    - `SUPABASE_URL`: Your Supabase project URL.
    - `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key.

### 3. Bot Permissions

The bot needs the correct permissions to create slash commands.

- **Action:** When you invited the bot to your server, make sure you authorized it with the `applications.commands` scope.
- **Re-invite if necessary:** If you're not sure, you can re-invite the bot with the correct permissions. You can generate a new invite link in the Discord Developer Portal.

### Potential Improvement

In the current implementation, the `/verify` command has the `email` option as optional. This means a user can run the command without an email, and the bot will then ask for it. For a better user experience, you might consider making the `email` option required.

To do this, you would change `required: false` to `required: true` in `scripts/register-guild-command.mjs` for the `email` option.
