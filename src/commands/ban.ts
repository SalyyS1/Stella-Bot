import { ChatInputCommandInteraction, GuildMember, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { config } from '../config';
import { banMember } from '../systems/moderation/mod-actions';

export default {
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban một thành viên khỏi server')
        .addUserOption(option => option.setName('user').setDescription('Thành viên bị ban').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Lý do').setRequired(true).setMaxLength(500))
        .addIntegerOption(option =>
            option.setName('delete_days')
                .setDescription('Xoá tin nhắn của họ trong N ngày gần đây (0-7)')
                .setRequired(false)
                .setMinValue(0)
                .setMaxValue(7))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
            return interaction.reply({ content: `${emojis.error} Bạn cần quyền Ban Members.`, flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const targetUser = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason', true);
        const deleteDays = interaction.options.getInteger('delete_days') ?? 0;

        try {
            const target = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            if (!target) {
                return interaction.editReply(
                    `${emojis.error} ${targetUser} không còn trong server. Dùng \`/mod unban\` nếu cần gỡ ban, ` +
                    'hoặc ban bằng ID qua Discord vì bot chỉ ban được thành viên đang ở trong server.'
                );
            }

            const result = await banMember(
                { guild: interaction.guild, actor: interaction.member as GuildMember },
                target,
                reason,
                deleteDays
            );

            return interaction.editReply(
                `${emojis.success} Đã ban ${targetUser} — hồ sơ **#${result.caseId}**.\n` +
                `Lý do: ${reason}` +
                (deleteDays ? `\nĐã xoá tin nhắn ${deleteDays} ngày gần đây.` : '') +
                (result.dmSent ? '\nĐã gửi DM thông báo lý do.' : `\n${emojis.appeal} Không gửi được DM (họ chặn DM).`)
            );
        } catch (error: any) {
            console.error('[ban] lỗi:', error);
            return interaction.editReply(`${emojis.error} ${error?.message || 'Không ban được thành viên này.'}`);
        }
    }
};
