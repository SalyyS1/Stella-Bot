import { Client } from 'discord.js';
import prisma from '../../lib/prisma';
import { config } from '../../config';
import { sendAdminLog } from '../../utils/adminLog';
import { awardInviteReward } from './invite-rewards';

// Đánh dấu người mới đã làm xong nhiệm vụ chọn lĩnh vực ở kênh welcome. Trả về
// dòng lượt mời nếu nó đang chờ, để caller nói cho người mới biết còn bao lâu nữa
// người mời của họ được ghi nhận.
export async function markRolePicked(userId: string) {
    const row = await prisma.inviteJoin.findUnique({ where: { invitedId: userId } }).catch(() => null);
    if (!row || row.rolePickedAt) return row;
    if (row.status !== 'PENDING') return row;

    return prisma.inviteJoin.update({
        where: { invitedId: userId },
        data: { rolePickedAt: new Date() }
    }).catch(() => row);
}

// Người rời server.
//
// Chưa verified thì mất luôn cơ hội ghi công (đúng cổng "ở lại ≥ 24h"). Đã verified
// rồi thì GIỮ công: người mời đã kéo về một người thật, việc người đó rời sau vài
// tuần không phải lỗi của họ. Chỉ ghi mốc rời để thống kê hiện được "đã rời".
export async function markLeft(userId: string): Promise<void> {
    const row = await prisma.inviteJoin.findUnique({ where: { invitedId: userId } }).catch(() => null);
    if (!row) return;

    if (row.status === 'PENDING' || row.status === 'REJECTED_YOUNG') {
        await prisma.inviteJoin.updateMany({
            where: { invitedId: userId, status: row.status },
            data: { status: 'LEFT', leftAt: new Date() }
        }).catch(() => {});
        return;
    }

    await prisma.inviteJoin.update({
        where: { invitedId: userId },
        data: { leftAt: new Date() }
    }).catch(() => {});
}

interface SweepResult {
    verified: number;
    dropped: number;
}

// Quét các lượt mời đã đủ điều kiện: đã chọn role, đã qua mốc giờ ở lại, và người
// được mời vẫn còn trong server.
export async function runVerificationSweep(client: Client): Promise<SweepResult> {
    const guild = client.guilds.cache.first();
    if (!guild) return { verified: 0, dropped: 0 };

    const cutoff = new Date(Date.now() - config.invites.stayHours * 3_600_000);
    const due = await prisma.inviteJoin.findMany({
        where: {
            status: 'PENDING',
            rolePickedAt: { not: null },
            joinedAt: { lte: cutoff }
        },
        take: 25
    }).catch(() => []);

    let verified = 0;
    let dropped = 0;

    for (const row of due) {
        const member = await guild.members.fetch(row.invitedId).catch(() => null);
        if (!member) {
            // Rời server mà event guildMemberRemove trượt (bot offline lúc đó).
            await prisma.inviteJoin.updateMany({
                where: { invitedId: row.invitedId, status: 'PENDING' },
                data: { status: 'LEFT', leftAt: new Date() }
            }).catch(() => {});
            dropped++;
            continue;
        }

        // Đây là chốt chống trả thưởng hai lần: chỉ phiên nào đổi được trạng thái
        // mới đi tiếp sang phần cộng xu.
        const claimed = await prisma.inviteJoin.updateMany({
            where: { invitedId: row.invitedId, status: 'PENDING' },
            data: { status: 'VERIFIED', verifiedAt: new Date() }
        }).catch(() => ({ count: 0 }));
        if (claimed.count !== 1) continue;

        verified++;
        await awardInviteReward(client, row.inviterId, row.invitedId, row.source).catch(error =>
            console.error(`[invite] trả thưởng lượt mời ${row.invitedId} lỗi:`, error)
        );
    }

    return { verified, dropped };
}

// Admin ép duyệt một lượt bị chặn vì tài khoản quá mới. Trả thưởng như đường
// thường để hai lối vào không lệch nhau.
export async function approveJoin(client: Client, invitedId: string, adminId: string) {
    const row = await prisma.inviteJoin.findUnique({ where: { invitedId } });
    if (!row) throw new Error('Người này không có dữ liệu lượt mời.');
    if (row.status === 'VERIFIED') throw new Error('Lượt mời này đã được tính.');

    const claimed = await prisma.inviteJoin.updateMany({
        where: { invitedId, status: row.status },
        data: {
            status: 'VERIFIED',
            verifiedAt: new Date(),
            note: `Admin ${adminId} duyệt tay (trạng thái cũ: ${row.status})`
        }
    });
    if (claimed.count !== 1) throw new Error('Trạng thái vừa bị đổi bởi phiên khác, thử lại.');

    const reward = await awardInviteReward(client, row.inviterId, invitedId, row.source);
    return { inviterId: row.inviterId, scoinPaid: reward.scoinPaid };
}

// Thu hồi một lượt mời gian. Xu đã trả KHÔNG bị lấy lại tự động: trừ ngược có thể
// đẩy số dư âm hoặc trừ vào xu người ta đã kiếm bằng việc khác. Admin muốn thu hồi
// xu thì dùng /scoin, và hành động đó nằm trong lịch sử giao dịch riêng.
export async function revokeJoin(invitedId: string, adminId: string, reason: string) {
    const row = await prisma.inviteJoin.findUnique({ where: { invitedId } });
    if (!row) throw new Error('Người này không có dữ liệu lượt mời.');

    await prisma.inviteJoin.update({
        where: { invitedId },
        data: {
            status: 'REVOKED',
            note: `Admin ${adminId} thu hồi: ${reason}`.slice(0, 500)
        }
    });
    return { inviterId: row.inviterId, previousStatus: row.status };
}

let sweepTimer: NodeJS.Timeout | null = null;
let sweepBusy = false;

export function startInviteVerificationScheduler(client: Client): void {
    if (!config.invites.enabled) return;
    if (sweepTimer) clearInterval(sweepTimer);

    const tick = async () => {
        if (sweepBusy) return;
        sweepBusy = true;
        try {
            const result = await runVerificationSweep(client);
            if (result.verified || result.dropped) {
                await sendAdminLog(client, {
                    title: 'Invite verification',
                    color: '#2ecc71',
                    description: `Đã tính **${result.verified}** lượt mời, bỏ **${result.dropped}** lượt vì người được mời đã rời.`
                }).catch(() => {});
            }
        } catch (error) {
            console.error('[invite] sweep lỗi:', error);
        } finally {
            sweepBusy = false;
        }
    };

    sweepTimer = setInterval(tick, config.invites.sweepIntervalMs);
    void tick();
}
