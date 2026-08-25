import { Guild, PermissionFlagsBits, Role } from 'discord.js';

// Cổng bảo mật cho MỌI đường bot tự cấp role (role menu, cổng verify, sau này là role tạm).
//
// Đây là chỗ nguy hiểm nhất của cả bộ quản lý: một menu công khai cấp role có quyền
// `ManageRoles` nghĩa là bất kỳ ai bấm được nút cũng tự lên admin được — và nó sẽ không
// trông giống một lỗ hổng, nó trông giống một cái nút màu xanh.
//
// Kiểm HAI lần là có chủ ý: lúc `/rolemenu add` và lúc người ta bấm. Role có thể được
// cấp thêm quyền SAU khi đã nằm trong menu, nên kiểm một lần lúc thêm là không đủ.

// Quyền khiến một role trở thành công cụ chiếm server. Không phân biệt nặng nhẹ: role
// nào có một trong số này thì không được phát tự động, chấm hết.
const DANGEROUS_PERMISSIONS = [
    { flag: PermissionFlagsBits.Administrator, label: 'Administrator' },
    { flag: PermissionFlagsBits.ManageGuild, label: 'Manage Server' },
    { flag: PermissionFlagsBits.ManageRoles, label: 'Manage Roles' },
    { flag: PermissionFlagsBits.ManageChannels, label: 'Manage Channels' },
    { flag: PermissionFlagsBits.ManageWebhooks, label: 'Manage Webhooks' },
    { flag: PermissionFlagsBits.ManageMessages, label: 'Manage Messages' },
    { flag: PermissionFlagsBits.BanMembers, label: 'Ban Members' },
    { flag: PermissionFlagsBits.KickMembers, label: 'Kick Members' },
    { flag: PermissionFlagsBits.ModerateMembers, label: 'Moderate Members' },
    { flag: PermissionFlagsBits.MentionEveryone, label: 'Mention Everyone' }
];

export interface RoleGateResult {
    ok: boolean;
    reason?: string;
}

export function checkRoleAssignable(guild: Guild, role: Role): RoleGateResult {
    if (role.id === guild.id) {
        return { ok: false, reason: 'Không thể phát role `@everyone`.' };
    }
    // Role của bot và role Nitro Booster do Discord quản lý — API từ chối mọi lượt cấp tay.
    if (role.managed) {
        return { ok: false, reason: `**${role.name}** do Discord/bot khác quản lý, không cấp tay được.` };
    }

    const dangerous = DANGEROUS_PERMISSIONS.find(entry => role.permissions.has(entry.flag));
    if (dangerous) {
        return {
            ok: false,
            reason: `**${role.name}** có quyền \`${dangerous.label}\`. Role có quyền quản trị không được phát tự động — ` +
                'bất kỳ ai bấm nút cũng sẽ có quyền đó.'
        };
    }

    const me = guild.members.me;
    if (!me) return { ok: false, reason: 'Không đọc được thông tin bot trong server.' };
    if (role.position >= me.roles.highest.position) {
        return {
            ok: false,
            reason: `Role **${role.name}** đang cao hơn (hoặc ngang) role của Stella nên bot không cấp được. ` +
                'Kéo role của Stella lên trên nó trong Server Settings → Roles.'
        };
    }

    return { ok: true };
}

/** Bản throw, dùng trong command để lỗi tự chảy vào khối catch chung. */
export function assertRoleAssignable(guild: Guild, role: Role): void {
    const result = checkRoleAssignable(guild, role);
    if (!result.ok) throw new Error(result.reason);
}
