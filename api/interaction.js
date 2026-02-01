
require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { verifyKey } = require('discord-interactions');
const fs = require('fs');
const path = require('path');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.commands = new Collection();
const commandFiles = fs.readdirSync(path.join(__dirname, '../src/commands')).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(`../src/commands/${file}`);
    client.commands.set(command.data.name, command);
}

module.exports = async (req, res) => {
    const signature = req.headers['x-signature-ed25519'];
    const timestamp = req.headers['x-signature-timestamp'];
    const rawBody = JSON.stringify(req.body);

    const isValidRequest = verifyKey(rawBody, signature, timestamp, process.env.PUBLIC_KEY);

    if (!isValidRequest) {
        return res.status(401).send('Invalid signature');
    }

    if (req.body.type === 1) { // PING
        return res.status(200).json({ type: 1 }); // PONG
    }

    if (req.body.type === 2) { // APPLICATION_COMMAND
        const commandName = req.body.data.name;
        const command = client.commands.get(commandName);

        if (!command) {
            return res.status(400).send('Unknown command');
        }

        try {
            // Re-construct the interaction object
            // This is a simplified version. For a real bot, you'd need a more robust solution
            // to handle all the properties and methods of the Interaction object.
            const interaction = {
                ...req.body,
                client: client,
                guild: await client.guilds.fetch(req.body.guild_id),
                member: {
                  roles: {
                    add: async (roles) => { console.log('Adding roles:', roles); },
                  },
                },
                user: req.body.member.user,
                options: {
                    getString: (name) => {
                        const option = req.body.data.options.find(o => o.name === name);
                        return option ? option.value : null;
                    }
                },
                deferReply: async (options) => { console.log('Deferring reply...'); },
                editReply: async (options) => { console.log('Editing reply:', options); },
                reply: async (options) => { console.log('Replying:', options); }, // This is a mock
            };

            await command.execute(interaction);
            return res.status(200).json({ type: 5 }); // ACK with source

        } catch (error) {
            console.error(error);
            return res.status(500).send('Internal server error');
        }
    }

    return res.status(404).send('Unknown interaction type');
};

// We need to log in to the client to fetch guild information
// This should be done carefully in a serverless environment
if (process.env.DISCORD_TOKEN) {
    client.login(process.env.DISCORD_TOKEN).catch(console.error);
}
