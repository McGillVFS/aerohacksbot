const DISCORD_APP_ID = process.env.DISCORD_APP_ID;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || "1440784109034274838";

if (!DISCORD_APP_ID || !DISCORD_BOT_TOKEN) {
  console.error("Missing required env vars: DISCORD_APP_ID and DISCORD_BOT_TOKEN");
  process.exit(1);
}

const commands = [
  {
    name: "verify",
    description: "Verify your hackathon registration.",
    type: 1,
    options: [
      {
        type: 3,
        name: "email",
        description: "Your registration email.",
        required: false,
      },
    ],
  },
];

const url = `https://discord.com/api/v10/applications/${DISCORD_APP_ID}/guilds/${DISCORD_GUILD_ID}/commands`;

const response = await fetch(url, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(commands),
});

if (!response.ok) {
  const body = await response.text();
  console.error(`Failed to register guild commands (${response.status}): ${body}`);
  process.exit(1);
}

const registered = await response.json();
console.log(
  `Registered ${registered.length} guild command(s) for guild ${DISCORD_GUILD_ID}: ${registered
    .map((cmd) => `/${cmd.name}`)
    .join(", ")}`
);
