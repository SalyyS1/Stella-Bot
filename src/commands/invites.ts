import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';
import { buildInviteLeaderboardEmbed, buildInviteStatsPayload } from '../systems/invite/invite-embeds';
import { approveJoin, revokeJoin } from '../systems/invite/invite-verification';
import { syncInviteCache } from '../systems/invite/invite-cache';
import { InviteRange } from '../systems/invite/invite-stats';

// Các lượt đáng nhìn kỹ: cùng một người mời kéo về nhiều acc mới trong 24h, hoặc
// người được mời vào rồi rời gần như ngay lập tức.
async function buildAuditEmbed() {
    const since = new Date(Date.now() - 24 * 3_600_000);
    const [youngGroups, quickLeaves] = await Promise.all([
        prisma.inviteJoin.groupBy({
            by: ['inviterId'],
            where: { status: 'REJECTED_YOUNG', joinedAt: { gte: since } },
            _count: { _all: true }
        }).catch(() => [] as { inviterId: string; _count: { _all: number } }[]),
        prisma.inviteJoin.findMany({
            where: { status: 'LEFT', leftAt: { not: null }, joinedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
            orderBy: { joinedAt: 'desc' },
            take: 100
        }).catch(() => [])
    ]);

    const suspicious = youngGroups
        .filter(row => row._count._all >= config.invites.auditYoungAccountThreshold)
        .map(row => `> <@${row.inviterId}> — **${row._count._all}** acc mới trong 24h`);

    const fastLeaves = quickLeaves
        .filter(row => row.leftAt && row.leftAt.getTime() - row.joinedAt.getTime() < 10 * 60_000)
        .slice(0, 10)
        .map(row => `> <@${row.invitedId}> (mời bởi <@${row.inviterId}>) — rời sau ${Math.max(1, Math.round((row.leftAt!.getTime() - row.joinedAt.getTime()) / 60_000))} phút`);

    return new EmbedBuilder()
        .setColor('#e67e22')
        .setTitle('Soi lượt mời nghi vấn')
        .addFields(
            {
                name: `Kéo nhiều acc mới (≥ ${config.invites.auditYoungAccountThreshold} acc / 24h)`,
                value: suspicious.join('\n') || '> *không có*',
                inline: false
            },
            {
                name: 'Vào rồi rời trong 10 phút (7 ngày qua)',
                value: fastLeaves.join('\n') || '> *không có*',
                inline: false
            }
        )
        .setFooter({ text: 'Dùng /invites revoke để thu hồi lượt gian' })
        .setTimestamp();
}

export default {
    data: new SlashCommandBuilder()
        .setName('invites')
        .setDescription('Xem và quản lý lượt mời')
        .addSubcommand(sub =>
            sub.setName('show')
                .setDescription('Xem lượt mời của một người')
                .addUserOption(option => option.setName('user').setDescription('Người bạn muốn xem').setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('top')
                .setDescription('Bảng xếp hạng lượt mời')
                .addStringOption(option =>
                    option.setName('range')
                        .setDescription('Phạm vi thời gian')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Từ trước tới giờ', value: 'all' },
                            { name: '30 ngày qua', value: 'month' },
                            { name: '7 ngày qua', value: 'week' }
                        )))
        .addSubcommand(sub =>
            sub.setName('approve')
                .setDescription('[Admin] Ép tính lượt mời cho một người bị chặn')
                .addUserOption(option => option.setName('user').setDescription('Người ĐƯỢC mời').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('revoke')
                .setDescription('[Admin] Thu hồi lượt mời gian')
                .addUserOption(option => option.setName('user').setDescription('Người ĐƯỢC mời').setRequired(true))
                .addStringOption(option => option.setName('reason').setDescription('Lý do').setRequired(true).setMaxLength(300)))
        .addSubcommand(sub =>
            sub.setName('rescan')
                .setDescription('[Admin] Đồng bộ lại danh sách invite (không đổi số cũ)'))
        .addSubcommand(sub =>
            sub.setName('audit')
                .setDescription('[Admin] Soi các lượt mời nghi vấn')),

    async execute(interaction: ChatInputCommandInteraction) {
        const sub = interaction.options.getSubcommand();
        const emojis = config.ui.emojis;
        const adminOnly = ['approve', 'revoke', 'rescan', 'audit'].includes(sub);
        if (adminOnly && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: `${emojis.error} Bạn cần quyền Administrator để dùng lệnh này.`, flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: adminOnly ? MessageFlags.Ephemeral : undefined });

        try {
            if (sub === 'show') {
                const target = interaction.options.getUser('user') || interaction.user;
                return interaction.editReply(await buildInviteStatsPayload(target));
            }

            if (sub === 'top') {
                const range = (interaction.options.getString('range') || 'all') as InviteRange;
                return interaction.editReply({ embeds: [await buildInviteLeaderboardEmbed(range, interaction.user.id)] });
            }

            if (sub === 'approve') {
                const target = interaction.options.getUser('user', true);
                const result = await approveJoin(interaction.client, target.id, interaction.user.id);
                return interaction.editReply(
                    `${emojis.success} Đã tính lượt mời của <@${result.inviterId}> cho ${target}.` +
                    (result.scoinPaid ? ` Đã trả **${result.scoinPaid}** Scoin.` : ' Không trả Scoin (lượt không rõ nguồn).')
                );
            }

            if (sub === 'revoke') {
                const target = interaction.options.getUser('user', true);
                const reason = interaction.options.getString('reason', true);
                const result = await revokeJoin(target.id, interaction.user.id, reason);
                return interaction.editReply(
                    `${emojis.success} Đã thu hồi lượt mời của <@${result.inviterId}> (trạng thái cũ: \`${result.previousStatus}\`).\n` +
                    `Scoin đã trả **không** bị trừ tự động — dùng \`/scoin\` nếu cần thu lại.`
                );
            }

            if (sub === 'rescan') {
                if (!interaction.guild) throw new Error('Chỉ dùng trong server.');
                const count = await syncInviteCache(interaction.guild);
                if (count === null) throw new Error('Không fetch được invite. Bot cần quyền **Manage Server**.');
                return interaction.editReply(
                    `${emojis.success} Đã đồng bộ **${count}** invite.\n` +
                    'Số lượt mời cũ (đã đóng băng) cố ý không bị quét lại: quét lại sẽ cộng đôi với số đang đếm chính xác.'
                );
            }

            return interaction.editReply({ embeds: [await buildAuditEmbed()] });
        } catch (error: any) {
            console.error('[invites] lỗi:', error);
            return interaction.editReply(`${emojis.error} ${error?.message || 'Không xử lý được lệnh invites.'}`);
        }
    }
};
