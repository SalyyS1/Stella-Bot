import { Collection, Guild, Invite } from 'discord.js';
import prisma from '../../lib/prisma';
import { sendAdminLog } from '../../utils/adminLog';

// Mã giả cho vanity URL (discord.gg/tencustom). Discord không cho biết ai "mời"
// qua vanity — chỉ có tổng số lượt dùng — nên nó được theo dõi như một invite
// riêng không có người tạo, và mọi lượt qua đây bị đánh dấu source=VANITY.
export const VANITY_CODE = '__vanity__';

// Đã cảnh báo thiếu quyền chưa. Không có cờ này thì mỗi lần một người join bot
// lại bắn một embed lỗi giống hệt vào kênh log.
let missingPermissionWarned = false;

export interface InviteSnapshot {
    code: string;
    inviterId: string | null;
    uses: number;
    maxUses: number;
    expiresAt: Date | null;
}

function toSnapshot(invite: Invite): InviteSnapshot {
    return {
        code: invite.code,
        inviterId: invite.inviterId ?? invite.inviter?.id ?? null,
        uses: invite.uses ?? 0,
        maxUses: invite.maxUses ?? 0,
        expiresAt: invite.expiresAt ?? null
    };
}

// Đọc trạng thái invite hiện tại từ Discord. Trả null khi không đọc được (thiếu
// quyền Manage Server) để caller phân biệt "server không có invite nào" với
// "bot không được phép xem" — hai chuyện dẫn tới hai cách xử lý khác nhau.
export async function fetchLiveInvites(guild: Guild): Promise<InviteSnapshot[] | null> {
    let fetched: Collection<string, Invite> | null = null;
    try {
        fetched = await guild.invites.fetch();
    } catch (error: any) {
        if (!missingPermissionWarned) {
            missingPermissionWarned = true;
            await sendAdminLog(guild.client, {
                title: 'Invite tracking không hoạt động',
                color: '#e74c3c',
                description: 'Bot không fetch được danh sách invite. Cần cấp quyền **Manage Server** cho bot, ' +
                    'nếu không thì phần "được ai mời" ở welcome và bảng xếp hạng lượt mời sẽ trống.\n' +
                    `Lỗi: \`${String(error?.message || error).slice(0, 300)}\``
            }).catch(() => {});
        }
        return null;
    }
    missingPermissionWarned = false;

    const snapshots = fetched.map(toSnapshot);

    // Vanity chỉ tồn tại khi server đủ boost; server không có thì API throw —
    // đó là trạng thái bình thường, không phải lỗi cần báo.
    try {
        const vanity = await guild.fetchVanityData();
        if (vanity?.code) {
            snapshots.push({
                code: VANITY_CODE,
                inviterId: null,
                uses: vanity.uses ?? 0,
                maxUses: 0,
                expiresAt: null
            });
        }
    } catch {
        // không có vanity URL — bỏ qua
    }

    return snapshots;
}

// Ghi ảnh chụp hiện tại vào DB. Xoá các mã không còn tồn tại để lần diff sau
// không so với invite đã chết.
export async function persistInviteSnapshots(snapshots: InviteSnapshot[]): Promise<void> {
    for (const snapshot of snapshots) {
        await prisma.inviteCache.upsert({
            where: { code: snapshot.code },
            update: {
                inviterId: snapshot.inviterId,
                uses: snapshot.uses,
                maxUses: snapshot.maxUses,
                expiresAt: snapshot.expiresAt
            },
            create: {
                code: snapshot.code,
                inviterId: snapshot.inviterId,
                uses: snapshot.uses,
                maxUses: snapshot.maxUses,
                expiresAt: snapshot.expiresAt
            }
        }).catch(error => console.error(`[invite] không lưu được cache mã ${snapshot.code}:`, error));
    }

    const liveCodes = snapshots.map(s => s.code);
    await prisma.inviteCache.deleteMany({
        where: liveCodes.length ? { code: { notIn: liveCodes } } : {}
    }).catch(error => console.error('[invite] không dọn được cache invite đã chết:', error));
}

export async function syncInviteCache(guild: Guild): Promise<number | null> {
    const snapshots = await fetchLiveInvites(guild);
    if (!snapshots) return null;
    await persistInviteSnapshots(snapshots);
    return snapshots.length;
}

export interface InviteResolution {
    code: string | null;
    inviterId: string | null;
    source: 'INVITE' | 'VANITY' | 'UNKNOWN';
}

// Tìm invite vừa được dùng bằng cách so ảnh chụp cũ với trạng thái mới, rồi lưu
// lại ảnh chụp mới.
//
// Cố ý KHÔNG đoán khi mơ hồ: nếu có nhiều hơn một mã tăng lượt (hai người join
// cùng lúc) thì trả UNKNOWN. Đoán bừa ở đây nghĩa là gán một lượt mời cho người
// không mời — sai kiểu đó tệ hơn là thiếu dữ liệu, vì nó vào cả bảng xếp hạng
// lẫn tỷ lệ giveaway.
export async function resolveUsedInvite(guild: Guild): Promise<InviteResolution> {
    const live = await fetchLiveInvites(guild);
    if (!live) return { code: null, inviterId: null, source: 'UNKNOWN' };

    const cached = await prisma.inviteCache.findMany().catch(() => []);
    const cachedByCode = new Map(cached.map(row => [row.code, row]));

    const grown = live.filter(snapshot => {
        const before = cachedByCode.get(snapshot.code);
        // Mã mới xuất hiện mà đã có lượt dùng: invite được tạo sau lần sync trước
        // (event inviteCreate trượt) rồi có người dùng ngay.
        if (!before) return snapshot.uses > 0;
        return snapshot.uses > before.uses;
    });

    // Invite dùng hết lượt bị Discord xoá ngay: mã cũ biến mất khỏi danh sách live.
    // Chỉ quy được khi đúng một mã như vậy, và mã đó phải sắp hết lượt.
    const liveCodes = new Set(live.map(s => s.code));
    const vanishedMaxed = cached.filter(row =>
        !liveCodes.has(row.code) && row.maxUses > 0 && row.uses >= row.maxUses - 1
    );

    await persistInviteSnapshots(live);

    if (grown.length === 1) {
        const used = grown[0];
        if (used.code === VANITY_CODE) return { code: null, inviterId: null, source: 'VANITY' };
        if (!used.inviterId) return { code: used.code, inviterId: null, source: 'UNKNOWN' };
        return { code: used.code, inviterId: used.inviterId, source: 'INVITE' };
    }

    if (grown.length === 0 && vanishedMaxed.length === 1) {
        const used = vanishedMaxed[0];
        if (!used.inviterId) return { code: used.code, inviterId: null, source: 'UNKNOWN' };
        return { code: used.code, inviterId: used.inviterId, source: 'INVITE' };
    }

    return { code: null, inviterId: null, source: 'UNKNOWN' };
}
