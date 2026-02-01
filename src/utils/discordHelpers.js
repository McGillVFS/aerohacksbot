const { Permissions } = require('discord.js');

/**
 * Sanitizes a string for use as a Discord role name.
 * @param {string} name - The original role name.
 * @returns {string} The sanitized role name.
 */
function sanitizeRoleName(name) {
  return name.replace(/[\`*_{}[\]()#+\-.!]/g, '').trim();
}

/**
 * Finds an existing role or creates a new one if it doesn't exist.
 * @param {import('discord.js').Guild} guild - The guild to create the role in.
 * @param {string} roleName - The name of the role.
 * @param {string} [color] - The color of the role.
 * @returns {Promise<import('discord.js').Role|null>} The role object or null if an error occurs.
 */
async function getOrCreateRole(guild, roleName, color = '#DEFAULT') {
  const sanitizedRoleName = sanitizeRoleName(roleName);
  if (!sanitizedRoleName) return null;

  const existingRole = guild.roles.cache.find(role => role.name.toLowerCase() === sanitizedRoleName.toLowerCase());
  if (existingRole) return existingRole;

  if (guild.roles.cache.size >= 250) {
    console.warn(`Role limit reached. Could not create role: "${sanitizedRoleName}"`);
    return null;
  }

  try {
    const newRole = await guild.roles.create({
      name: sanitizedRoleName,
      color,
      permissions: [],
    });
    return newRole;
  } catch (error) {
    console.error(`Failed to create role "${sanitizedRoleName}":`, error);
    return null;
  }
}

module.exports = { getOrCreateRole, sanitizeRoleName };