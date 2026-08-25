import { GuildMember } from 'discord.js';
import prisma from '../../lib/prisma';
import { config } from '../../config';
import { resolveUsedInvite } from './invite-cache';

export interface JoinAttribution {
    /** Người được ghi công (đã áp fallback). */
    inviterId: string;
    /** Người mời thật do Discord trả về, null nếu không quy được. */
    rawInviterId: string | null;
    code: string | null;
    source: 'INVITE' | 'VANITY' | 'UNKNOWN';
    status: string;
    isRejoin: boolean;
    /** Tuổi tài khoản Discord tính theo ngày, làm tròn xuống. */
    accountAgeDays: number;
}

function accountAgeInDays(createdAt: Date): number {
    return Math.floor((Date.now() - createdAt.getTime()) / 86_400_000);
}

// Ghi nhận một lượt join và quyết ai được ghi công.
//
// Trả null khi hệ thống tắt hoặc là bot join — caller dùng nó để bỏ hẳn dòng
// "được ai mời" ở welcome thay vì hiện một cái tên đoán bừa.
export async function recordJoin(member: GuildMember): Promise<JoinAttribution | null> {
    if (!config.invites.enabled) return null;
    if (member.user.bot) return null;

    const resolution = await resolveUsedInvite(member.guild);
    const fallbackId = config.invites.fallbackInviterId;

    // Tự mời chính mình là dấu hiệu dữ liệu sai (hoặc trò lách bằng chính link của
    // mình) — dồn về fallback thay vì cho ai đó tự cộng lượt cho bản thân.
    const rawInviterId = resolution.inviterId === member.id ? null : resolution.inviterId;
    const inviterId = rawInviterId || fallbackId;

    const accountCreatedAt = member.user.createdAt;
    const accountAgeDays = accountAgeInDays(accountCreatedAt);
    const tooYoung = accountAgeDays < config.invites.minAccountAgeDays;

    const existing = await prisma.inviteJoin.findUnique({ where: { invitedId: member.id } }).catch(() => null);
    if (existing) {
        // Vào lại KHÔNG tạo dòng mới và KHÔNG mở lại cơ hội ghi công: đó chính là
        // cách farm rẻ nhất (mời một người, cho rời, mời lại). Chỉ đếm số lần vào
        // lại để admin nhìn thấy hành vi đó.
        await prisma.inviteJoin.update({
            where: { invitedId: member.id },
            data: {
                rejoinCount: { increment: 1 },
                leftAt: null,
                note: existing.note || 'Đã vào lại server sau khi rời'
            }
        }).catch(() => {});
        return {
            inviterId: existing.inviterId,
            rawInviterId: existing.source === 'INVITE' ? existing.inviterId : null,
            code: existing.code,
            source: existing.source as JoinAttribution['source'],
            status: existing.status,
            isRejoin: true,
            accountAgeDays
        };
    }

    const status = tooYoung ? 'REJECTED_YOUNG' : 'PENDING';
    await prisma.inviteJoin.create({
        data: {
            invitedId: member.id,
            inviterId,
            code: resolution.code,
            source: resolution.source,
            status,
            accountCreatedAt,
            note: tooYoung
                ? `Tài khoản mới ${accountAgeDays} ngày (< ${config.invites.minAccountAgeDays}) — cần admin duyệt tay`
                : null
        }
    }).catch(error => console.error('[invite] không ghi được lượt join:', error));

    return {
        inviterId,
        rawInviterId,
        code: resolution.code,
        source: resolution.source,
        status,
        isRejoin: false,
        accountAgeDays
    };
}
