const fetch = require('node-fetch');

/**
 * Sanitizes a string for use as a Discord role name.
 * @param {string} name - The original role name.
 * @returns {string} The sanitized role name.
 */
function sanitizeRoleName(name) {
  return name.replace(/[\`*_{}[\]()#+\-.!]/g, '').trim();
}

/**
 * Finds an existing role or creates a new one if it doesn't exist, using the Discord REST API.
 * @param {string} guildId - The ID of the guild.
 * @param {string} roleName - The name of the role.
 * @param {string} [color] - The color of the role.
 * @returns {Promise<object|null>} The role object or null if an error occurs.
 */
async function getOrCreateRole(guildId, roleName, color = '#DEFAULT') {
    const sanitizedRoleName = sanitizeRoleName(roleName);
    if (!sanitizedRoleName) return null;

    const url = `https://discord.com/api/v10/guilds/${guildId}/roles`;
    const headers = {
        'Authorization': `Bot ${process.env.DISCORD_TOKEN}`,
        'Content-Type': 'application/json'
    };

    try {
        // Fetch all roles from the guild
        let response = await fetch(url, { headers });
        if (!response.ok) {
            throw new Error(`Failed to fetch roles: ${await response.text()}`);
        }
        const roles = await response.json();

        // Check if the role already exists
        const existingRole = roles.find(role => role.name.toLowerCase() === sanitizedRoleName.toLowerCase());
        if (existingRole) {
            return existingRole;
        }

        // If the role doesn't exist, create it
        response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                name: sanitizedRoleName,
                color: color === '#DEFAULT' ? null : parseInt(color.slice(1), 16),
                permissions: '0' // No permissions
            })
        });

        if (!response.ok) {
            throw new Error(`Failed to create role: ${await response.text()}`);
        }

        return await response.json();

    } catch (error) {
        console.error(`Error in getOrCreateRole for role "${sanitizedRoleName}":`, error);
        return null;
    }
}

module.exports = { getOrCreateRole, sanitizeRoleName };