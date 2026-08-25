import { Client, EmbedBuilder } from 'discord.js';
import prisma from '../../lib/prisma';
import { config } from '../../config';
import { sendMessageLog } from '../logs/message-log-sender';
import { modCaseLabel } from './mod-case-manager';
import { RULE_LABEL, type AutomodRuleKey } from '../automod/automod-settings';
import { claimWork, releaseWork } from '../report/report-claim';
import { weekKeyFor } from '../weekly-reward-manager';

// Bản tin kiểm duyệt: số liệu tuần cho mod, đăng ở kênh log.
//
// CỐ Ý không ghép vào `report-weekly.ts`. Cái đó là tờ báo cộng đồng do AI viết, đăng ở
// kênh nhật báo cho mọi người đọc. Bản tin này là số liệu nội bộ, không cần AI, và một
// lỗi số liệu ở đây không được phép chặn tờ báo cộng đồng.

const DIGEST_KIND = 'modreport';

interface Section {
    name: string;
    value: string;
}

function pushIf(sections: Section[], name: string, lines: string[]): void {
    // Mục rỗng bị bỏ hẳn, không in "0": một bản tin toàn số 0 làm người đọc bỏ luôn
    // thói quen mở nó ra.
    if (lines.length) sections.push({ name, value: lines.join('\n').slice(0, 1024) });
}

export async function buildModDigest(days: number): Promise<EmbedBuilder> {
    const since = new Date(Date.now() - days * 86_400_000);
    const sections: Section[] = [];

    const [deleted, edited, topDeleted, cases, strikes, joins, youngRejects, watches, locks] = await Promise.all([
        prisma.messageMirror.count({ where: { deletedAt: { gte: since } } }).catch(() => 0),
        prisma.messageMirror.count({ where: { editedAt: { gte: since } } }).catch(() => 0),
        prisma.messageMirror.groupBy({
            by: ['authorId'],
            where: { deletedAt: { gte: since } },
            _count: { authorId: true },
            orderBy: { _count: { authorId: 'desc' } },
            take: 5
        }).catch(() => [] as any[]),
        prisma.modCase.groupBy({
            by: ['kind'],
            where: { createdAt: { gte: since } },
            _count: { kind: true }
        }).catch(() => [] as any[]),
        prisma.automodStrike.groupBy({
            by: ['rule'],
            where: { createdAt: { gte: since } },
            _count: { rule: true },
            orderBy: { _count: { rule: 'desc' } }
        }).catch(() => [] as any[]),
        prisma.inviteJoin.count({ where: { joinedAt: { gte: since } } }).catch(() => 0),
        prisma.inviteJoin.count({ where: { joinedAt: { gte: since }, status: 'REJECTED_YOUNG' } }).catch(() => 0),
        prisma.watchTarget.count().catch(() => 0),
        prisma.channelLock.count().catch(() => 0)
    ]);

    pushIf(sections, 'Tin nhắn', [
        deleted ? `Bị xoá: **${deleted}**` : '',
        edited ? `Bị sửa: **${edited}**` : ''
    ].filter(Boolean));

    pushIf(sections, 'Bị xoá tin nhiều nhất', topDeleted.map((row: any) =>
        `<@${row.authorId}> — **${row._count.authorId}** tin`
    ));

    pushIf(sections, 'Hồ sơ kỷ luật mới', cases.map((row: any) =>
        `${modCaseLabel(row.kind)}: **${row._count.kind}**`
    ));

    pushIf(sections, 'Vi phạm automod', strikes.map((row: any) =>
        `${RULE_LABEL[row.rule as AutomodRuleKey] || row.rule}: **${row._count.rule}**`
    ));

    // Tỷ lệ giữ người: chỉ có nghĩa khi có người mới trong kỳ, nên tính trong nhánh này.
    const retentionLines: string[] = [];
    if (joins) {
        const left = await prisma.inviteJoin
            .count({ where: { joinedAt: { gte: since }, leftAt: { not: null } } })
            .catch(() => 0);
        const stayed = joins - left;
        retentionLines.push(`Người mới: **${joins}** · còn ở lại: **${stayed}** (${Math.round((stayed / joins) * 100)}%)`);
        if (youngRejects) retentionLines.push(`Acc quá mới bị từ chối tính lượt mời: **${youngRejects}**`);
    }
    pushIf(sections, 'Thành viên mới', retentionLines);

    pushIf(sections, 'Đang mở', [
        watches ? `Đang theo dõi: **${watches}** người` : '',
        locks ? `Kênh đang khoá: **${locks}**` : ''
    ].filter(Boolean));

    const embed = new EmbedBuilder()
        .setColor('#3498db')
        .setTitle(`Bản tin kiểm duyệt · ${days} ngày qua`)
        .setFooter({ text: 'Chỉ mục có số liệu được hiện · /inspect để soi từng người' })
        .setTimestamp();

    if (!sections.length) {
        embed.setDescription(`${config.ui.emojis.success} Không có gì đáng chú ý trong ${days} ngày qua.`);
        return embed;
    }
    embed.addFields(sections.map(section => ({ ...section, inline: false })));
    return embed;
}

/** Chủ nhật (Saigon) và đã qua 20h? Cùng cách tính múi giờ với report-weekly.ts. */
function isSundayEveningSaigon(nowMs = Date.now()): boolean {
    // BẮT BUỘC chỉ rõ timeZone: để Intl dùng giờ host thì trên host ≥ UTC+10, Chủ nhật
    // 20h Saigon đã là thứ Hai bên host và bản tin không bao giờ chạy — lỗi im lặng.
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: config.maintenance.timezone,
        weekday: 'short',
        hour: '2-digit',
        hour12: false
    }).formatToParts(new Date(nowMs));
    const weekday = parts.find(part => part.type === 'weekday')?.value;
    const hour = Number(parts.find(part => part.type === 'hour')?.value ?? '0');
    return weekday === 'Sun' && hour >= 20;
}

export async function runModDigest(client: Client): Promise<'posted' | 'already' | 'skipped'> {
    if (!isSundayEveningSaigon()) return 'skipped';

    const weekKey = weekKeyFor(new Date());
    if (!(await claimWork(DIGEST_KIND, weekKey))) return 'already';

    let posted = false;
    try {
        const embed = await buildModDigest(7);
        const sent = await sendMessageLog(client, { embeds: [embed] });
        posted = Boolean(sent);
        return posted ? 'posted' : 'skipped';
    } finally {
        // Giữ claim khi ĐÃ đăng (restart không đăng trùng); nhả khi chưa để tick sau thử lại.
        if (!posted) await releaseWork(DIGEST_KIND, weekKey);
    }
}

export function startModDigestScheduler(client: Client): void {
    // Nhịp một giờ: cửa sổ đăng là "Chủ nhật sau 20h", nên độ chính xác giờ là đủ, và
    // `claimWork` lo phần không đăng trùng.
    setInterval(() => {
        void runModDigest(client).catch(error => console.error('[mod-digest] lỗi:', error));
    }, 60 * 60_000);
}
