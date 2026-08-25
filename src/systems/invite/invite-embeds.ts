import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, User } from 'discord.js';
import { config } from '../../config';
import {
    countInvitedList,
    getInvitedList,
    getInviteLeaderboard,
    getInviteRank,
    getInviteStats,
    getInviterOf,
    InviteRange,
    rangeLabel
} from './invite-stats';

const PER_PAGE = 15;

const STATUS_LABEL: Record<string, string> = {
    PENDING: 'đang chờ',
    VERIFIED: 'đã tính',
    REJECTED_YOUNG: 'acc quá mới',
    LEFT: 'đã rời',
    REVOKED: 'bị thu hồi'
};

function statusLabel(status: string): string {
    return STATUS_LABEL[status] || status.toLowerCase();
}

// Thẻ thống kê lượt mời của một người.
export async function buildInviteStatsPayload(target: User) {
    const emojis = config.ui.emojis;
    const [stats, rank, inviter, recent] = await Promise.all([
        getInviteStats(target.id),
        getInviteRank(target.id),
        getInviterOf(target.id),
        getInvitedList(target.id, 5)
    ]);

    const recentLines = recent.length
        ? recent.map(row => `> <@${row.invitedId}> · \`${statusLabel(row.status)}\` · <t:${Math.floor(row.joinedAt.getTime() / 1000)}:R>`).join('\n')
        : '> *chưa mời được ai từ lúc hệ thống bật*';

    const inviterLine = inviter
        ? inviter.source === 'INVITE'
            ? `> <@${inviter.inviterId}> (${statusLabel(inviter.status)})`
            : '> *vào bằng link công khai của server*'
        : '> *không có dữ liệu — vào trước khi hệ thống bật*';

    const embed = new EmbedBuilder()
        .setColor('#ff66cc')
        .setAuthor({ name: `Lượt mời của ${target.username}`, iconURL: target.displayAvatarURL({ size: 128 }) })
        .setDescription(
            `${emojis.starJump} Tổng cộng **${stats.total.toLocaleString('vi-VN')}** lượt mời` +
            (rank ? ` · hạng **#${rank}**` : '')
        )
        .addFields(
            {
                name: `${emojis.success} Đã tính`,
                value: `> **${stats.verified.toLocaleString('vi-VN')}** người\n> *(qua đủ cổng chống bot)*`,
                inline: true
            },
            {
                name: `${emojis.note} Số cũ (xấp xỉ)`,
                value: `> **${stats.legacy.toLocaleString('vi-VN')}** lượt\n> *(quét từ invite còn sống)*`,
                inline: true
            },
            {
                name: `${emojis.budget} Scoin từ mời`,
                value: `> **${stats.scoinEarned.toLocaleString('vi-VN')}**`,
                inline: true
            },
            {
                name: `${emojis.keep} Chưa tính`,
                value: `> đang chờ: **${stats.pending}** · acc quá mới: **${stats.rejectedYoung}**\n` +
                    `> đã rời: **${stats.left}** · bị thu hồi: **${stats.revoked}**`,
                inline: false
            },
            { name: `${emojis.contact} Ai mời bạn`, value: inviterLine, inline: false },
            { name: `${emojis.purpleArrow} Mời gần đây`, value: recentLines, inline: false }
        )
        .setFooter({ text: 'Số cũ là xấp xỉ: Discord không lưu lịch sử ai mời ai' })
        .setTimestamp();

    if (stats.vanityOrUnknown > 0) {
        embed.addFields({
            name: `${emojis.emptyStar} Vào bằng link công khai`,
            value: `> **${stats.vanityOrUnknown}** lượt được dồn về đây vì Discord không cho biết ai mời.\n` +
                '> *Không sinh Scoin, chỉ để không bị mất dấu.*',
            inline: false
        });
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`invite_list_${target.id}_0`)
            .setLabel('Xem tất cả người đã mời')
            .setStyle(ButtonStyle.Primary)
            .setEmoji(emojis.note)
    );

    return { embeds: [embed], components: [row] };
}

// Danh sách người đã mời, phân trang.
export async function buildInvitedListPayload(userId: string, page: number) {
    const total = await countInvitedList(userId);
    const maxPage = Math.max(0, Math.ceil(total / PER_PAGE) - 1);
    const safePage = Math.min(Math.max(0, page), maxPage);
    const rows = await getInvitedList(userId, PER_PAGE, safePage * PER_PAGE);

    const lines = rows.length
        ? rows.map((row, index) =>
            `**${safePage * PER_PAGE + index + 1}.** <@${row.invitedId}> · \`${statusLabel(row.status)}\`` +
            `${row.rejoinCount ? ` · vào lại ${row.rejoinCount}×` : ''} · <t:${Math.floor(row.joinedAt.getTime() / 1000)}:d>`
        ).join('\n')
        : '*Chưa có ai.*';

    const embed = new EmbedBuilder()
        .setColor('#ff66cc')
        .setTitle('Danh sách người đã mời')
        .setDescription(`Người mời: <@${userId}>\n\n${lines}`)
        .setFooter({ text: `Trang ${safePage + 1}/${maxPage + 1} · tổng ${total} lượt` });

    const nav = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`invite_list_${userId}_${safePage - 1}`)
            .setLabel('Trước')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage <= 0),
        new ButtonBuilder()
            .setCustomId(`invite_list_${userId}_${safePage + 1}`)
            .setLabel('Sau')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage >= maxPage)
    );

    return { embeds: [embed], components: [nav] };
}

// Bảng xếp hạng lượt mời.
export async function buildInviteLeaderboardEmbed(range: InviteRange, viewerId: string) {
    const board = await getInviteLeaderboard(range, 10);
    const medals = ['🥇', '🥈', '🥉'];

    const lines = board.length
        ? board.map((row, index) => {
            const medal = medals[index] || `\`#${index + 1}\``;
            const detail = range === 'all' && row.legacy
                ? ` *(${row.verified} mới + ${row.legacy} cũ)*`
                : '';
            return `${medal} <@${row.inviterId}> — **${row.total.toLocaleString('vi-VN')}** lượt${detail}`;
        }).join('\n')
        : '*Chưa có dữ liệu lượt mời.*';

    const viewerRank = board.findIndex(row => row.inviterId === viewerId);

    return new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle(`🏆 Bảng Xếp Hạng Lượt Mời · ${rangeLabel(range)}`)
        .setDescription(lines)
        .setFooter({
            text: viewerRank >= 0
                ? `Bạn đang ở hạng #${viewerRank + 1}`
                : 'Bạn chưa có lượt mời nào được tính trong phạm vi này'
        })
        .setTimestamp();
}
