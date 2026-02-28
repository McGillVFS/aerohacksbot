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
      // --- Step A & B: Identity Check & Linking ---
      let registration = await findRegistrationByDiscordId(discordUserId);

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

      // --- Step C: Dynamic Role Assignment ---
      const member = interaction.member;
      const guild = interaction.guild;
      const rolesToAdd = [];

      // Attendee Role
      const attendeeRole = await getOrCreateRole(guild, 'Attendee');
      if (attendeeRole) rolesToAdd.push(attendeeRole);

      // School Role
      if (registration.school) {
        const schoolRole = await getOrCreateRole(guild, registration.school);
        if (schoolRole) rolesToAdd.push(schoolRole);
      }

      // Team Role
      if (registration.team_mode === 'team' && registration.team_name) {
        const teamRole = await getOrCreateRole(guild, `Team: ${registration.team_name}`);
        if (teamRole) rolesToAdd.push(teamRole);
      }

      // Interest Roles
      if (registration.interests && Array.isArray(registration.interests)) {
        for (const interest of registration.interests) {
          const interestRole = await getOrCreateRole(guild, `Interest: ${interest}`);
          if (interestRole) rolesToAdd.push(interestRole);
        }
      }

      await member.roles.add(rolesToAdd);

      // --- Step D: Welcome/DM Logic ---
      const formLink = 'https://forms.gle/4vzvLBiXjXMVXp4XA';
      const welcomeMessage = `🎉 **Welcome to the hackathon!**\n\nPlease take a moment to fill out this short onboarding form:\n${formLink}`;

      try {
        await interaction.user.send(welcomeMessage);
        await interaction.editReply('You have been successfully verified! Check your DMs for a welcome message.');
      } catch (dmError) {
        console.warn('Unable to DM verified user:', dmError.message);
        await interaction.editReply(`You have been successfully verified! I wasn’t able to send you a DM; please fill out the form here: ${formLink}`);
      }

    } catch (error) {
      console.error('Verification failed:', error);
      // Ensure we only reply if we haven't already replied/deferred
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('An error occurred during verification. Please try again later.');
      } else {
        await interaction.reply({ content: 'An error occurred during verification.', ephemeral: true });
      }
    }
  },
};