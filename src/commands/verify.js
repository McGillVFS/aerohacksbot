
const { SlashCommandBuilder } = require('discord.js');
const { findRegistrationByDiscordId, findRegistrationByEmail, linkDiscordId } = require('../utils/supabase');
const { getOrCreateRole } = require('../utils/discordHelpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Verify your hackathon registration.')
    .addStringOption(option =>
      option.setName('email')
        .setDescription('Your registration email.')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const discordUserId = interaction.user.id;
    const providedEmail = interaction.options.getString('email');

    try {
      // Step A: Automatic Identity Check
      let registration = await findRegistrationByDiscordId(discordUserId);

      // Step B: Email Claim (If ID check fails)
      if (!registration) {
        if (!providedEmail) {
          return interaction.editReply('Please provide your email to verify: `/verify email:your@email.com`');
        }

        registration = await findRegistrationByEmail(providedEmail);

        if (!registration) {
          return interaction.editReply('We couldn\'t find your registration. Please register at [Registration Site URL].');
        }

        if (registration.discord_user_id) {
            return interaction.editReply('This email is already linked to another Discord account.');
        }

        registration = await linkDiscordId(providedEmail, discordUserId);
      }

      // Step C: Dynamic Role Assignment
      const member = interaction.member;
      const guild = interaction.guild;

      const rolesToAdd = [];

      const verifiedRole = await getOrCreateRole(guild, 'Verified Hacker', '#5865F2');
      if (verifiedRole) rolesToAdd.push(verifiedRole);

      if (registration.school) {
        const schoolRole = await getOrCreateRole(guild, registration.school);
        if (schoolRole) rolesToAdd.push(schoolRole);
      }

      if (registration.team_mode === 'team' && registration.team_name) {
        const teamRole = await getOrCreateRole(guild, `Team: ${registration.team_name}`);
        if (teamRole) rolesToAdd.push(teamRole);
      }

      if (registration.interests && registration.interests.length > 0) {
        for (const interest of registration.interests) {
          const interestRole = await getOrCreateRole(guild, `Interest: ${interest}`);
          if (interestRole) rolesToAdd.push(interestRole);
        }
      }

      await member.roles.add(rolesToAdd);

      await interaction.editReply('You have been successfully verified!');
    } catch (error) {
      console.error('Verification failed:', error);
      await interaction.editReply('An error occurred during verification. Please try again later.');
    }
  },
};
