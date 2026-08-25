import { ChatInputCommandInteraction, GuildMember, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { config } from '../config';
import { timeoutMember } from '../systems/moderation/mod-actions';
import { formatDuration, parseDurationMs } from '../utils/parse-duration';

const MAX_TIMEOUT_MS = 28 * 86_400_000;

export default {
    data: new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('Câm một thành viên trong một khoảng thời gian (mute của Discord)')
        .addUserOption(option => option.setName('user').setDescription('Thành viên bị câm').setRequired(true))
        .addStringOption(option => option.setName('duration').setDescription('VD: 10m, 2h, 3d, 1h30m — tối đa 28d').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Lý do').setRequired(true).setMaxLength(500))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ content: `${emojis.error} Bạn cần quyền Moderate Members.`, flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const targetUser = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason', true);

        try {
            const durationMs = parseDurationMs(interaction.options.getString('duration', true), {
                maxMs: MAX_TIMEOUT_MS,
                minMs: 60_000,
                maxLabel: '28 ngày (giới hạn của Discord)'
            });

            const target = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            if (!target) return interaction.editReply(`${emojis.error} ${targetUser} không còn trong server.`);

            const result = await timeoutMember(
                { guild: interaction.guild, actor: interaction.member as GuildMember },
                target,
                durationMs,
                reason
            );

            const until = Math.floor((Date.now() + durationMs) / 1000);
            return interaction.editReply(
                `${emojis.success} Đã câm ${targetUser} **${formatDuration(durationMs)}** — hồ sơ **#${result.caseId}**.\n` +
                `Hết hạn <t:${until}:R> (<t:${until}:f>)\nLý do: ${reason}` +
                (result.dmSent ? '\nĐã gửi DM thông báo lý do.' : `\n${emojis.appeal} Không gửi được DM (họ chặn DM).`)
            );
        } catch (error: any) {
            console.error('[timeout] lỗi:', error);
            return interaction.editReply(`${emojis.error} ${error?.message || 'Không câm được thành viên này.'}`);
        }
    }
};
