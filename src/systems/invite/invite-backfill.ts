import { Guild } from 'discord.js';
import prisma from '../../lib/prisma';
import { config } from '../../config';
import { sendAdminLog } from '../../utils/adminLog';
import { fetchLiveInvites, VANITY_CODE } from './invite-cache';

export interface BackfillResult {
    ranNow: boolean;
    inviterCount: number;
    totalUses: number;
    fallbackUses: number;
}

// Quét MỘT LẦN số lượt mời của quá khứ.
//
// Giới hạn không lách được: Discord không có API lịch sử "ai mời ai". Thứ duy nhất
// đọc được là tổng `uses` của các invite CÒN TỒN TẠI, nên:
//   - ra được con số cho mỗi người mời, KHÔNG ra được danh sách người đã mời;
//   - invite đã bị xoá hoặc hết hạn thì số lượt của nó mất vĩnh viễn;
//   - vanity URL chỉ có tổng, không có người mời → dồn về fallback theo chốt của Saly.
//
// Và vì sao chỉ chạy một lần: sau khi hệ thống live, `uses` tiếp tục tăng theo đúng
// những lượt join đã được đếm chính xác ở InviteJoin.VERIFIED. Quét lại rồi cộng
// hai nguồn là đếm đôi. Có dữ liệu là dừng.
export async function runInviteBackfillOnce(guild: Guild): Promise<BackfillResult> {
    const already = await prisma.inviteBackfill.count().catch(() => 0);
    if (already > 0) {
        return { ranNow: false, inviterCount: already, totalUses: 0, fallbackUses: 0 };
    }

    const snapshots = await fetchLiveInvites(guild);
    if (!snapshots) return { ranNow: false, inviterCount: 0, totalUses: 0, fallbackUses: 0 };

    const fallbackId = config.invites.fallbackInviterId;
    const usesByInviter = new Map<string, number>();
    let fallbackUses = 0;
    let totalUses = 0;

    for (const snapshot of snapshots) {
        if (snapshot.uses <= 0) continue;
        totalUses += snapshot.uses;
        const isUnattributed = snapshot.code === VANITY_CODE || !snapshot.inviterId;
        const owner = isUnattributed ? fallbackId : snapshot.inviterId!;
        if (isUnattributed) fallbackUses += snapshot.uses;
        usesByInviter.set(owner, (usesByInviter.get(owner) ?? 0) + snapshot.uses);
    }

    for (const [inviterId, legacyUses] of usesByInviter) {
        await prisma.inviteBackfill.upsert({
            where: { inviterId },
            update: { legacyUses },
            create: { inviterId, legacyUses }
        }).catch(error => console.error(`[invite] backfill ${inviterId} lỗi:`, error));
    }

    const top = [...usesByInviter.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([id, uses], index) => `**${index + 1}.** <@${id}> — ${uses} lượt`)
        .join('\n') || 'Không có invite nào còn lượt dùng.';

    await sendAdminLog(guild.client, {
        title: 'Invite backfill (một lần, đã đóng băng)',
        color: '#f1c40f',
        description:
            `Đã quét **${snapshots.length}** invite còn tồn tại: **${totalUses}** lượt dùng của **${usesByInviter.size}** người.\n` +
            `Trong đó **${fallbackUses}** lượt không quy được về ai (vanity / invite không rõ người tạo) → dồn về <@${fallbackId}>.\n\n` +
            `Số này là **xấp xỉ**: invite đã bị xoá hoặc hết hạn thì Discord không còn dữ liệu, và không thể truy ra từng người đã được mời. ` +
            `Từ giờ mọi lượt mới được đếm chính xác và tách riêng.\n\n**Top:**\n${top}`
    }).catch(() => {});

    return { ranNow: true, inviterCount: usesByInviter.size, totalUses, fallbackUses };
}
