import { Client, Guild, Role } from 'discord.js';
import prisma from '../../lib/prisma';
import { config } from '../../config';
import { checkRoleAssignable } from '../rolemenu/role-assignable-gate';
import { sendMessageLog } from '../logs/message-log-sender';
import { EmbedBuilder } from 'discord.js';

// Role có hạn (`/role add @u @r 3d`).
//
// Chốt đáng chú ý: chạy một lượt NGAY khi bot lên, không chờ tick đầu tiên. Role đáng ra
// hết hạn lúc bot đang tắt phải được gỡ ngay khi bot lên — nếu chờ tick thì một người bị
// cấp role tạm rồi bot tắt qua đêm sẽ giữ role đó thêm cả đêm cộng một phút, mà đó chính
// là ca người ta để ý nhất.

const SWEEP_INTERVAL_MS = 60_000;

export async function grantTempRole(input: {
    guild: Guild;
    userId: string;
    role: Role;
    durationMs: number;
    grantedBy: string;
    reason: string | null;
}) {
    const gate = checkRoleAssignable(input.guild, input.role);
    if (!gate.ok) throw new Error(gate.reason);

    const member = await input.guild.members.fetch(input.userId).catch(() => null);
    if (!member) throw new Error('Không tìm thấy thành viên này trong server.');

    await member.roles.add(input.role.id, `Role tạm: ${input.reason || 'không ghi lý do'}`);

    const expiresAt = new Date(Date.now() + input.durationMs);
    // Unique (userId, roleId): cấp lại là GIA HẠN, không sinh dòng thứ hai. Hai dòng cho
    // cùng một role nghĩa là dòng hết hạn trước sẽ gỡ role mà dòng còn lại vẫn tưởng còn.
    return prisma.tempRole.upsert({
        where: { userId_roleId: { userId: input.userId, roleId: input.role.id } },
        update: { expiresAt, grantedBy: input.grantedBy, reason: input.reason },
        create: {
            userId: input.userId,
            roleId: input.role.id,
            expiresAt,
            grantedBy: input.grantedBy,
            reason: input.reason
        }
    });
}

export async function revokeTempRole(guild: Guild, userId: string, roleId: string): Promise<boolean> {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) await member.roles.remove(roleId, 'Gỡ role tạm bằng tay').catch(() => {});
    const removed = await prisma.tempRole.deleteMany({ where: { userId, roleId } }).catch(() => ({ count: 0 }));
    return removed.count > 0;
}

export async function listTempRoles(userId?: string) {
    return prisma.tempRole
        .findMany({ where: userId ? { userId } : undefined, orderBy: { expiresAt: 'asc' } })
        .catch(() => []);
}

/** Gỡ mọi role tạm đã hết hạn. Trả về số role đã gỡ. */
export async function sweepExpiredTempRoles(guild: Guild): Promise<number> {
    const expired = await prisma.tempRole
        .findMany({ where: { expiresAt: { lte: new Date() } } })
        .catch(() => []);
    if (!expired.length) return 0;

    let removed = 0;
    for (const row of expired) {
        const member = await guild.members.fetch(row.userId).catch(() => null);
        if (member) {
            const ok = await member.roles.remove(row.roleId, 'Role tạm hết hạn').then(() => true).catch(() => false);
            if (ok) {
                removed++;
                await sendMessageLog(guild.client, {
                    embeds: [new EmbedBuilder()
                        .setColor('#95a5a6')
                        .setTitle('Role tạm hết hạn')
                        .setDescription(`Đã gỡ <@&${row.roleId}> của <@${row.userId}>.`)
                        .setTimestamp()]
                }).catch(() => {});
            }
        }
        // Xoá dòng dù gỡ được hay không: member đã rời server hoặc role đã bị xoá thì
        // dòng đó không còn việc gì để làm, giữ lại chỉ khiến mỗi tick thử lại mãi.
        await prisma.tempRole.deleteMany({ where: { id: row.id } }).catch(() => {});
    }

    if (removed) console.log(`[temp-role] đã gỡ ${removed} role hết hạn.`);
    return removed;
}

export function startTempRoleScheduler(client: Client): void {
    const run = async () => {
        const guild = client.guilds.cache.first();
        if (!guild) return;
        await sweepExpiredTempRoles(guild).catch(error => console.error('[temp-role] sweep lỗi:', error));
    };

    // Ngay lập tức rồi mới định kỳ — xem comment đầu file.
    void run();
    setInterval(run, SWEEP_INTERVAL_MS);
}

export const TEMP_ROLE_MAX_MS = config.moderation.tempRoleMaxDays * 86_400_000;
