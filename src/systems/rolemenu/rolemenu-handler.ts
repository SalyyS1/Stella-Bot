import { ButtonInteraction, GuildMember, MessageFlags, StringSelectMenuInteraction } from 'discord.js';
import { config } from '../../config';
import { safeInteractionReply } from '../../utils/interaction-safe-reply';
import { checkRoleAssignable } from './role-assignable-gate';
import { getMenu, type RoleMenuMode } from './rolemenu-store';

// Xử lý người bấm role menu.
//
// Nguyên tắc: KHÔNG tin customId. Nó nằm trong tay client, ai cũng gửi được một
// interaction giả với roleId tuỳ ý. Nên roleId phải được đối chiếu lại với danh sách
// option trong DB, rồi mới đi qua cổng an toàn `checkRoleAssignable` lần nữa — role có
// thể đã được cấp thêm quyền sau khi nó vào menu.

interface ApplyResult {
    added: string[];
    removed: string[];
    rejected: string[];
}

async function applyRoles(
    member: GuildMember,
    mode: RoleMenuMode,
    menuRoleIds: string[],
    requested: string[]
): Promise<ApplyResult> {
    const result: ApplyResult = { added: [], removed: [], rejected: [] };
    const guild = member.guild;

    const toAdd: string[] = [];
    const toRemove: string[] = [];

    for (const roleId of requested) {
        const role = guild.roles.cache.get(roleId);
        if (!role) {
            result.rejected.push('Một role trong menu đã bị xoá khỏi server.');
            continue;
        }
        const gate = checkRoleAssignable(guild, role);
        if (!gate.ok) {
            result.rejected.push(gate.reason!);
            continue;
        }

        const has = member.roles.cache.has(roleId);
        // `verify` chỉ cấp: bấm lại không được gỡ. Cổng xác minh mà bấm nhầm lần hai là
        // tự đá mình ra khỏi server thì không ai dám bấm.
        if (has && mode !== 'verify') toRemove.push(roleId);
        else if (!has) toAdd.push(roleId);
    }

    // `unique`: giữ đúng một role trong menu → gỡ mọi role khác của CHÍNH menu này.
    // Không đụng tới role ngoài menu: một người có thể đang giữ role màu, role level...
    if (mode === 'unique' && toAdd.length) {
        for (const roleId of menuRoleIds) {
            if (!toAdd.includes(roleId) && member.roles.cache.has(roleId)) toRemove.push(roleId);
        }
    }

    if (toRemove.length) {
        await member.roles.remove(toRemove, 'Role menu').catch(() => {
            result.rejected.push('Stella không gỡ được role (thiếu quyền hoặc role cao hơn bot).');
        });
        result.removed.push(...toRemove);
    }
    if (toAdd.length) {
        await member.roles.add(toAdd, 'Role menu').catch(() => {
            result.rejected.push('Stella không cấp được role (thiếu quyền hoặc role cao hơn bot).');
        });
        result.added.push(...toAdd);
    }

    return result;
}

export async function handleRoleMenuComponent(
    interaction: ButtonInteraction | StringSelectMenuInteraction
): Promise<void> {
    const emojis = config.ui.emojis;
    const parts = interaction.customId.split('_');
    const kind = parts[1]; // btn | sel
    const menuId = Number(parts[2]);
    if (!Number.isInteger(menuId)) return;

    const menu = await getMenu(menuId).catch(() => null);
    if (!menu) {
        await safeInteractionReply(interaction, {
            content: `${emojis.error} Menu này đã bị xoá. Nhờ admin đăng lại nhé.`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const menuRoleIds = menu.options.map(option => option.roleId);
    const requested = kind === 'sel'
        ? (interaction as StringSelectMenuInteraction).values
        : [parts.slice(3).join('_')];

    // Chốt chống customId giả: chỉ nhận role thật sự nằm trong menu này.
    const valid = requested.filter(roleId => menuRoleIds.includes(roleId));
    if (!valid.length) {
        await safeInteractionReply(interaction, {
            content: `${emojis.error} Lựa chọn không hợp lệ.`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const member = interaction.member instanceof GuildMember
        ? interaction.member
        : await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return;

    const mode = menu.mode as RoleMenuMode;
    // Select ở chế độ multi: những role của menu mà người ta BỎ chọn phải được gỡ, nếu
    // không thì select chỉ cộng dồn và không bao giờ bỏ được role nào.
    const target = kind === 'sel' && mode === 'multi'
        ? [...new Set([...valid, ...menuRoleIds.filter(id => member.roles.cache.has(id) && !valid.includes(id))])]
        : valid;

    const result = await applyRoles(member, mode, menuRoleIds, target);

    const lines: string[] = [];
    if (result.added.length) lines.push(`${emojis.success} Đã nhận: ${result.added.map(id => `<@&${id}>`).join(', ')}`);
    if (result.removed.length) lines.push(`${emojis.close} Đã bỏ: ${result.removed.map(id => `<@&${id}>`).join(', ')}`);
    for (const reason of new Set(result.rejected)) lines.push(`${emojis.error} ${reason}`);
    if (!lines.length) lines.push(`${emojis.note} Không có gì thay đổi.`);

    await safeInteractionReply(interaction, {
        content: lines.join('\n'),
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] }
    });
}
