import { GuildMember, PartialGuildMember } from 'discord.js';
import prisma from '../../lib/prisma';
import { config } from '../../config';

// Role nào được coi là role kỷ luật.
//
// Ưu tiên danh sách id trong config; chưa cấu hình thì đoán theo tên. Cố ý KHÔNG
// trả lại mọi role: một role vừa bị gỡ có chủ đích (hạ quyền, gỡ role thưởng hết
// hạn) sẽ tự mọc lại chỉ vì người đó rời rồi vào lại.
function isDisciplineRole(roleId: string, roleName: string): boolean {
    if (config.moderation.stickyRoleIds.includes(roleId)) return true;
    if (config.moderation.stickyRoleIds.length) return false;
    const lowered = roleName.toLowerCase();
    return config.moderation.stickyRoleNamePatterns.some(pattern => lowered.includes(pattern));
}

// Lưu role kỷ luật lúc rời server.
export async function saveStickyRoles(member: GuildMember | PartialGuildMember): Promise<string[]> {
    if (member.partial) return [];
    const roleIds = member.roles.cache
        .filter(role => role.id !== member.guild.id && isDisciplineRole(role.id, role.name))
        .map(role => role.id);

    if (!roleIds.length) {
        await prisma.stickyRole.deleteMany({ where: { userId: member.id } }).catch(() => {});
        return [];
    }

    await prisma.stickyRole.upsert({
        where: { userId: member.id },
        update: { roleIds: roleIds.join(','), savedAt: new Date() },
        create: { userId: member.id, roleIds: roleIds.join(',') }
    }).catch(error => console.error('[moderation] lưu sticky role lỗi:', error));

    return roleIds;
}

// Trả lại role kỷ luật khi member vào lại. Trả về danh sách role đã cấp lại để
// caller ghi vào log — im lặng khôi phục thì mod sẽ tưởng người đó vẫn đang bị mute
// mà không biết bot là thứ giữ nguyên trạng.
export async function restoreStickyRoles(member: GuildMember): Promise<string[]> {
    const row = await prisma.stickyRole.findUnique({ where: { userId: member.id } }).catch(() => null);
    if (!row) return [];

    const restored: string[] = [];
    for (const roleId of row.roleIds.split(',').filter(Boolean)) {
        const role = member.guild.roles.cache.get(roleId);
        if (!role) continue;
        const added = await member.roles.add(role, 'Stella — trả lại role kỷ luật sau khi vào lại').then(() => true).catch(() => false);
        if (added) restored.push(roleId);
    }

    // Chỉ xoá bản lưu khi đã trả lại xong: lỗi giữa đường thì lần vào lại sau vẫn
    // còn dữ liệu để thử tiếp.
    if (restored.length === row.roleIds.split(',').filter(Boolean).length) {
        await prisma.stickyRole.delete({ where: { userId: member.id } }).catch(() => {});
    }

    return restored;
}
