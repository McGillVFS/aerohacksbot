require('dotenv').config();
const { verifyKey } = require('discord-interactions');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

// A client is still needed for command discovery and routing
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
client.commands = new Collection();

const commandsPath = path.join(__dirname, '../src/commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    }
}

// Disable Vercel's default body parser for this endpoint
module.exports.config = {
    api: {
        bodyParser: false,
    },
};

// Helper to buffer the raw request body
async function buffer(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks);
}

// The main serverless function handler
module.exports = async (req, res) => {
    const signature = req.headers['x-signature-ed25519'];
    const timestamp = req.headers['x-signature-timestamp'];
    const rawBody = await buffer(req);

    const isValidRequest = verifyKey(
        rawBody,
        signature,
        timestamp,
        process.env.PUBLIC_KEY
    );

    if (!isValidRequest) {
        console.warn('Invalid signature');
        return res.status(401).send('Invalid signature');
    }

    const interaction = JSON.parse(rawBody.toString('utf8'));

    if (interaction.type === 1) { // PING
        console.log('Responding to PING');
        return res.status(200).json({ type: 1 }); // PONG
    }

    if (interaction.type === 2) { // APPLICATION_COMMAND
        const command = client.commands.get(interaction.data.name);

        if (!command) {
            console.error(`Command not found: ${interaction.data.name}`);
            return res.status(400).json({ error: 'Command not found' });
        }

        // Acknowledge the interaction immediately and defer the response.
        // This is crucial for long-running commands in a serverless environment.
        res.status(200).json({ type: 5 }); 

        try {
            // Now, execute the command logic.
            await command.execute(interaction);
        } catch (error) {
            console.error('Error executing command:', error);
            // You can use the Followup API to send an error message to the user.
        }

        return; // Important to prevent any further response writes.
    }

    console.warn(`Unknown interaction type: ${interaction.type}`);
    res.status(400).json({ error: 'Unknown interaction type' });
};