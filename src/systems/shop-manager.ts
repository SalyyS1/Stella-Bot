import { Guild, GuildMember, PermissionFlagsBits } from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';
import { adjustScoin, getScoinBalance } from './scoinManager';
import { markInternalAntiRaidAction } from './antiRaidManager';

// Ensure a shop color role exists in the guild. If the role is missing or was
// deleted, create it with anti-raid internal allow. Position is set ONLY at
// creation time — Discord clamps it to bot's highest role automatically. NEVER
// call setPosition afterwards as position-only updates trigger anti-raid roleUpdate.
export async function ensureColorRole(guild: Guild, colorKey: string): Promise<string> {
    const colorMeta = config.shop.colors.find(c => c.key === colorKey);
    if (!colorMeta) throw new Error(`Màu không tồn tại: ${colorKey}`);

    // Look up persisted role ID
    const record = await prisma.shopColorRole.findUnique({ where: { key: colorKey } });

    // Verify the role still exists in guild
    if (record) {
        const existing = await guild.roles.fetch(record.roleId).catch(() => null);
        if (existing) return existing.id;
    }

    // Role missing or was deleted — create new one
    const botMember = guild.members.me;
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
        throw new Error('Bot không có quyền quản lý role.');
    }

    // Mark internal action BEFORE creating role to prevent anti-raid strike
    markInternalAntiRaidAction('roleCreate', '*');

    const role = await guild.roles.create({
        name: `🎨 ${colorMeta.label}`,
        color: colorMeta.hex as any,
        permissions: [],
        mentionable: false,
        // Position set only at create; Discord clamps to bot's highest role position
        position: botMember.roles.highest.position,
        reason: 'Stella Shop — màu tên thành viên'
    });

    // Persist role ID for reuse
    await prisma.shopColorRole.upsert({
        where: { key: colorKey },
        update: { roleId: role.id },
        create: { key: colorKey, roleId: role.id }
    });

    return role.id;
}

// Buy a color role. Returns Vietnamese success message on success, throws Error
// with Vietnamese message on failure. Debits Scoin FIRST so insufficient balance
// fails fast without side effects. Refunds if role assignment fails.
export async function buyColorRole(guild: Guild, userId: string, colorKey: string): Promise<string> {
    // Validate shop enabled
    if (!config.shop.enabled) {
        throw new Error('Shop hiện đang đóng cửa.');
    }

    // Validate color key exists
    const colorMeta = config.shop.colors.find(c => c.key === colorKey);
    if (!colorMeta) {
        throw new Error(`Màu "${colorKey}" không tồn tại.`);
    }

    // Check bot permissions
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
        throw new Error('Bot không có quyền quản lý role.');
    }

    // Fetch member
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
        throw new Error('Không tìm thấy thành viên trong server.');
    }

    // Ensure the color role exists
    const targetRoleId = await ensureColorRole(guild, colorKey);

    // Check if member already has this color role
    if (member.roles.cache.has(targetRoleId)) {
        throw new Error(`Bạn đã sở hữu màu **${colorMeta.label}** rồi.`);
    }

    const price = config.shop.colorRolePrice;

    // Debit Scoin FIRST — throws 'Not enough Scoin.' if insufficient balance
    try {
        await adjustScoin(
            userId,
            -price,
            `Mua màu tên: ${colorMeta.label}`,
            'shop:color',
            colorKey
        );
    } catch (error) {
        // Map the scoinManager error to Vietnamese
        if (error instanceof Error && error.message === 'Not enough Scoin.') {
            const balance = await getScoinBalance(userId);
            throw new Error(`Không đủ Scoin. Bạn có **${balance.toLocaleString('vi-VN')}** Scoin, cần **${price.toLocaleString('vi-VN')}** Scoin.`);
        }
        throw error;
    }

    // Remove any other shop color roles the member currently has
    const allShopColorRoles = await prisma.shopColorRole.findMany();
    const shopRoleIds = new Set(allShopColorRoles.map(r => r.roleId));
    const memberShopRoles = member.roles.cache.filter(r => shopRoleIds.has(r.id));

    for (const [, role] of memberShopRoles) {
        if (role.id !== targetRoleId) {
            await member.roles.remove(role).catch(() => {});
        }
    }

    // Add the new color role
    try {
        await member.roles.add(targetRoleId);
    } catch (error) {
        // Role assignment failed — REFUND the Scoin
        await adjustScoin(
            userId,
            price,
            'Hoàn tiền shop (gán role lỗi)',
            'shop:refund',
            colorKey
        );
        throw new Error(`Không thể gán role màu. Đã hoàn lại **${price.toLocaleString('vi-VN')}** Scoin.`);
    }

    // Record purchase for audit trail
    await prisma.shopPurchase.create({
        data: {
            userId,
            itemKey: colorKey,
            price
        }
    });

    return `Đã mua thành công màu **${colorMeta.label}**! 🎨`;
}

// List the color key(s) the member currently owns. Returns the key if the member
// has exactly one shop color role, null otherwise. Used for display in /shop xem.
export async function listOwnedColorKey(member: GuildMember): Promise<string | null> {
    const allShopColorRoles = await prisma.shopColorRole.findMany();
    const roleIdToKey = new Map(allShopColorRoles.map(r => [r.roleId, r.key]));

    const memberShopRoles = member.roles.cache.filter(r => roleIdToKey.has(r.id));

    if (memberShopRoles.size === 0) return null;

    // Return the first one (should be exactly one after purchase logic)
    const firstRole = [...memberShopRoles.values()][0];
    return roleIdToKey.get(firstRole.id) || null;
}
