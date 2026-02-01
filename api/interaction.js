require('dotenv').config();
const { verifyKey } = require('discord-interactions');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

// --- Client and Command Setup ---
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

// --- Raw Body Buffer Helper ---
async function buffer(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks);
}

// --- Main Serverless Handler ---
const handler = async (req, res) => {
    console.log('Interaction received.'); // Entry log

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
        console.warn('Signature verification failed!');
        return res.status(401).send('Invalid signature');
    }
    console.log('Signature verified.');

    const interaction = JSON.parse(rawBody.toString('utf8'));

    if (interaction.type === 1) { // PING
        console.log('Handling PING request.');
        return res.status(200).json({ type: 1 }); // PONG
    }

    if (interaction.type === 2) { // APPLICATION_COMMAND
        console.log(`Handling command: ${interaction.data.name}`);
        const command = client.commands.get(interaction.data.name);

        if (!command) {
            console.error(`Command not found: ${interaction.data.name}`);
            return res.status(400).json({ error: 'Command not found' });
        }

        res.status(200).json({ type: 5 }); // Defer response

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error('Error executing command:', error);
        }
        return;
    }

    console.warn(`Unknown interaction type: ${interaction.type}`);
    res.status(400).json({ error: 'Unknown interaction type' });
};

// --- Vercel Configuration ---
// This MUST be a separate named export and not attached to the handler itself.
const config = {
    api: {
        bodyParser: false,
    },
};

// --- Exports ---
// The handler is the default export, and config is a named export.
// This is the correct pattern for Vercel Serverless Functions.
module.exports = handler;
module.exports.config = config;
