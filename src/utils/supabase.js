const { createClient } = require('@supabase/supabase-js');

// Initialize the Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Finds a registration by Discord user ID.
 * @param {string} discordUserId - The user's Discord ID.
 * @returns {Promise<object|null>} The registration data or null if not found.
 */
async function findRegistrationByDiscordId(discordUserId) {
  const { data, error } = await supabase
    .from('registrations')
    .select('*')
    .eq('discord_user_id', discordUserId)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116: 'single' row not found
    console.error('Error fetching registration by Discord ID:', error);
    throw new Error('Supabase query failed.');
  }

  return data;
}

/**
 * Finds a registration by email.
 * @param {string} email - The user's email.
 * @returns {Promise<object|null>} The registration data or null if not found.
 */
async function findRegistrationByEmail(email) {
  const { data, error } = await supabase
    .from('registrations')
    .select('*')
    .eq('email', email)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching registration by email:', error);
    throw new Error('Supabase query failed.');
  }

  return data;
}

/**
 * Updates a registration to link a Discord user ID.
 * @param {string} email - The user's email.
 * @param {string} discordUserId - The user's Discord ID.
 * @returns {Promise<object>} The updated registration data.
 */
async function linkDiscordId(email, discordUserId) {
  const { data, error } = await supabase
    .from('registrations')
    .update({ discord_user_id: discordUserId })
    .eq('email', email)
    .select()
    .single();

  if (error) {
    console.error('Error updating registration:', error);
    throw new Error('Supabase update failed.');
  }

  return data;
}

module.exports = {
  findRegistrationByDiscordId,
  findRegistrationByEmail,
  linkDiscordId,
};