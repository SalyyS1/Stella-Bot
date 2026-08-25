import { ChatInputCommandInteraction, GuildMember, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { config } from '../config';
import { kickMember } from '../systems/moderation/mod-actions';

export default {
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick một thành viên khỏi server')
        .addUserOption(option => option.setName('user').setDescription('Thành viên bị kick').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Lý do').setRequired(true).setMaxLength(500))
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.KickMembers)) {
            return interaction.reply({ content: `${emojis.error} Bạn cần quyền Kick Members.`, flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const targetUser = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason', true);

        try {
            const target = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            if (!target) return interaction.editReply(`${emojis.error} ${targetUser} không còn trong server.`);

            const result = await kickMember(
                { guild: interaction.guild, actor: interaction.member as GuildMember },
                target,
                reason
            );

            return interaction.editReply(
                `${emojis.success} Đã kick ${targetUser} — hồ sơ **#${result.caseId}**.\nLý do: ${reason}` +
                (result.dmSent ? '\nĐã gửi DM thông báo lý do.' : `\n${emojis.appeal} Không gửi được DM (họ chặn DM).`)
            );
        } catch (error: any) {
            console.error('[kick] lỗi:', error);
            return interaction.editReply(`${emojis.error} ${error?.message || 'Không kick được thành viên này.'}`);
        }
    }
};
