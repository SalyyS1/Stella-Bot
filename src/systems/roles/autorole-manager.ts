import { Guild, GuildMember, Role } from 'discord.js';
import prisma from '../../lib/prisma';
import { checkRoleAssignable } from '../rolemenu/role-assignable-gate';

// Autorole: role cấp cho MỌI người mới vào server.
//
// Đây là đường phát role rộng nhất trong cả bot, nên nó dùng đúng cổng an toàn của role
// menu (`checkRoleAssignable`) và kiểm HAI lần: lúc thêm vào danh sách, và lúc cấp cho
// từng người. Role có thể được cấp thêm quyền sau khi đã nằm trong danh sách — và nếu
// không kiểm lại thì mọi acc tạo 5 giây trước đều thành mod, tự động, không ai bấm gì.

export async function listAutoRoles() {
    return prisma.autoRole.findMany({ orderBy: { createdAt: 'asc' } }).catch(() => []);
}

export async function addAutoRole(guild: Guild, role: Role, addedBy: string): Promise<void> {
    const gate = checkRoleAssignable(guild, role);
    if (!gate.ok) throw new Error(gate.reason);
    await prisma.autoRole.upsert({
        where: { roleId: role.id },
        update: { addedBy },
        create: { roleId: role.id, addedBy }
    });
}

export async function removeAutoRole(roleId: string): Promise<boolean> {
    const removed = await prisma.autoRole.deleteMany({ where: { roleId } }).catch(() => ({ count: 0 }));
    return removed.count > 0;
}

export interface AutoRoleResult {
    granted: string[];
    skipped: { roleId: string; reason: string }[];
}

/** Cấp toàn bộ autorole cho một người mới vào. */
export async function applyAutoRoles(member: GuildMember): Promise<AutoRoleResult> {
    const result: AutoRoleResult = { granted: [], skipped: [] };
    if (member.user.bot) return result;

    const rows = await listAutoRoles();
    if (!rows.length) return result;

    const toGrant: string[] = [];
    for (const row of rows) {
        const role = member.guild.roles.cache.get(row.roleId);
        if (!role) {
            // Role đã bị xoá khỏi server: dọn dòng chết để danh sách không giữ rác mãi.
            await removeAutoRole(row.roleId);
            continue;
        }
        // Kiểm lại lần hai — xem comment đầu file.
        const gate = checkRoleAssignable(member.guild, role);
        if (!gate.ok) {
            result.skipped.push({ roleId: row.roleId, reason: gate.reason! });
            continue;
        }
        if (!member.roles.cache.has(row.roleId)) toGrant.push(row.roleId);
    }

    if (toGrant.length) {
        const added = await member.roles.add(toGrant, 'Autorole').then(() => true).catch(() => false);
        if (added) result.granted.push(...toGrant);
        else result.skipped.push({ roleId: toGrant.join(','), reason: 'Stella không cấp được (thiếu quyền)' });
    }

    return result;
}
