import { Guild, GuildMember, PermissionFlagsBits } from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';
import { adjustScoin, adjustScoinTx, getScoinBalance } from './scoinManager';
import { markInternalAntiRaidAction } from './antiRaidManager';

// Ghi món đã mua vào sổ đơn. Tách ra vì cả đường mua role màu và đường mua vật
// phẩm đều cần, và cả hai đều phải ghi TRONG transaction đã trừ xu.
async function recordPurchase(tx: any, userId: string, itemKey: string, price: number): Promise<void> {
    await tx.shopPurchase.create({
        data: { userId, itemKey, price, status: 'DELIVERED', deliveredAt: new Date() }
    });
}

// Khoá dòng User để hai lần mua đồng thời không cùng đọc một số dư. Increment 0
// không đổi giá trị nhưng vẫn lấy row lock của Postgres.
async function lockUser(tx: any, userId: string): Promise<void> {
    await tx.user.upsert({ where: { id: userId }, update: {}, create: { id: userId } });
    await tx.user.update({ where: { id: userId }, data: { scoinBalance: { increment: 0 } } });
}

// Trừ xu có điều kiện: chỉ trừ khi số dư còn đủ, và biết được mình có trừ được hay
// không qua count. Đây là chỗ chặn số dư âm mà không cần đọc-rồi-ghi.
async function debitIfEnough(
    tx: any, userId: string, amount: number, reason: string, source: string, metadata?: string
): Promise<void> {
    const charged = await tx.user.updateMany({
        where: { id: userId, scoinBalance: { gte: amount } },
        data: { scoinBalance: { decrement: amount } }
    });
    if (charged.count === 0) throw new Error('Not enough Scoin.');
    await tx.scoinTransaction.create({ data: { userId, amount: -amount, reason, source, metadata } });
}

// Mua một vật phẩm trong config.shop.items.
//
// Mọi thao tác nằm trong MỘT transaction: khoá dòng, trừ xu, ghi hiệu lực món, ghi
// đơn. Lý do không tách ra như buyColorRole: giữa hai transaction rời rạc, bot có
// thể chết (hoặc DB ngắt) sau khi đã trừ xu và trước khi món được ghi — người dùng
// mất xu, không có món, và không có dòng đơn nào để ai biết chuyện đó từng xảy ra.
// Cấp role Discord buộc phải nằm ngoài DB nên buyColorRole không có lựa chọn; vật
// phẩm thì hoàn toàn nằm trong DB, nên nó phải là một khối.
export async function buyShopItem(userId: string, itemKey: string): Promise<{ label: string; expiresAt: Date }> {
    if (!config.shop.enabled) throw new Error('Shop hiện đang đóng cửa.');
    const item = config.shop.items.find(i => i.key === itemKey);
    if (!item) throw new Error(`Vật phẩm "${itemKey}" không tồn tại.`);

    try {
        return await prisma.$transaction(async tx => {
            await lockUser(tx, userId);

            const now = new Date();
            // Mua tiếp khi buff còn hiệu lực thì GIA HẠN, không mở buff thứ hai —
            // hai buff cùng loại chạy song song là trả tiền hai lần cho một hiệu ứng.
            const active = await tx.starBuff.findFirst({
                where: { userId, key: item.buffKey, expiresAt: { gt: now } },
                orderBy: { expiresAt: 'desc' }
            });

            await debitIfEnough(tx, userId, item.price, `Mua ${item.label}`, 'shop:item', item.key);

            const base = active ? active.expiresAt.getTime() : now.getTime();
            const expiresAt = new Date(Math.max(base, now.getTime()) + item.durationMs);
            if (active) {
                await tx.starBuff.update({ where: { id: active.id }, data: { expiresAt } });
            } else {
                await tx.starBuff.create({ data: { userId, key: item.buffKey, expiresAt } });
            }

            await recordPurchase(tx, userId, item.key, item.price);
            return { label: item.label, expiresAt };
        });
    } catch (error) {
        if (error instanceof Error && error.message === 'Not enough Scoin.') {
            const balance = await getScoinBalance(userId);
            throw new Error(
                `Không đủ Scoin. Bạn có **${balance.toLocaleString('vi-VN')}**, cần **${item.price.toLocaleString('vi-VN')}**.`
            );
        }
        throw error;
    }
}

// Lịch sử mua của CHÍNH người gọi. Chỉ trả về đơn của userId được truyền vào —
// không có tham số nào cho phép xem đơn của người khác, vì đơn hàng là chuyện
// riêng: nó cho biết ai tiêu gì, và sau này là ai đã mua sản phẩm nào.
export async function listPurchaseHistory(userId: string, take = 15) {
    return prisma.shopPurchase.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take
    }).catch(() => []);
}

// ---- Hàng số (plugin/docs của chủ server) ----

// Link tải đọc từ env, không từ config: link là thứ có giá trị, commit vào git
// nghĩa là ai clone repo cũng có. Món chưa có link → coi như chưa bán (fail-closed),
// tốt hơn là bán rồi DM một chuỗi rỗng.
function digitalLink(itemKey: string): string | null {
    const item = config.shop.digitalGoods.find(g => g.key === itemKey);
    if (!item) return null;
    const link = process.env[item.linkEnv];
    return link && link.trim() ? link.trim() : null;
}

export function listAvailableDigitalGoods() {
    return config.shop.digitalGoods.filter(g => digitalLink(g.key) !== null);
}

// Lỗi khi gửi DM. Chỉ mang mã lỗi, KHÔNG mang error gốc của discord.js: error đó
// chứa requestBody.json — tức là cả payload, tức là cả link. console.error(error)
// ở tầng trên sẽ in nguyên nó ra log, và handler interaction còn gửi stack vào
// kênh botLog. Ném lại một lỗi sạch là cách duy nhất chắc chắn link không đi xa hơn.
class DmFailedError extends Error {
    constructor(public readonly code: string | number | undefined) {
        super('DM_FAILED');
        this.name = 'DmFailedError';
    }
}

export interface DigitalPurchaseResult {
    label: string;
    // Đã giao được link chưa. false = đã hoàn xu, người mua không mất gì.
    delivered: boolean;
    alreadyOwned: boolean;
}

// Mua một món hàng số. Hai pha vì việc giao hàng (gửi DM) nằm NGOÀI database nên
// không thể ở trong transaction:
//
//   pha 1 (tx): khoá dòng → chặn mua trùng → trừ xu → ghi đơn PENDING
//   gửi DM link
//   pha 2 (tx): DELIVERED, hoặc hoàn xu + REFUNDED nếu DM thất bại
//
// Trạng thái đơn là thứ chặn "hoàn xu rồi vẫn đổi được hàng": redeem chỉ nhận đơn
// DELIVERED, nên một đơn đã hoàn xu không còn là bằng chứng đã trả tiền. Nếu chỉ
// xoá/giữ đơn mà không có trạng thái thì hoàn xu và nhận hàng là hai đường độc lập
// và người mua đi cả hai là được hàng miễn phí.
export async function buyDigitalGood(
    user: { id: string; send: (payload: any) => Promise<unknown> },
    itemKey: string
): Promise<DigitalPurchaseResult> {
    if (!config.shop.enabled) throw new Error('Shop hiện đang đóng cửa.');
    const item = config.shop.digitalGoods.find(g => g.key === itemKey);
    if (!item) throw new Error(`Món "${itemKey}" không tồn tại.`);
    const link = digitalLink(itemKey);
    if (!link) throw new Error(`Món **${item.label}** chưa mở bán.`);

    // Pha 1: trừ xu và ghi đơn PENDING trong một transaction.
    let orderId: number;
    try {
        orderId = await prisma.$transaction(async tx => {
            await lockUser(tx, user.id);
            // Hàng số mua một lần là dùng mãi: đã có rồi thì lấy lại link miễn phí
            // qua /shop redeem, không trả tiền lần hai. Đơn REFUNDED không tính là
            // đã mua — nó là lần mua thất bại đã được hoàn xu.
            const owned = await tx.shopPurchase.findFirst({
                where: { userId: user.id, itemKey, status: 'DELIVERED' }
            });
            if (owned) throw new Error('ALREADY_OWNED');
            await debitIfEnough(tx, user.id, item.price, `Mua ${item.label}`, 'shop:digital', item.key);
            const order = await tx.shopPurchase.create({
                data: { userId: user.id, itemKey, price: item.price, status: 'PENDING' }
            });
            return order.id;
        });
    } catch (error) {
        if (error instanceof Error && error.message === 'ALREADY_OWNED') {
            return { label: item.label, delivered: false, alreadyOwned: true };
        }
        if (error instanceof Error && error.message === 'Not enough Scoin.') {
            const balance = await getScoinBalance(user.id);
            throw new Error(
                `Không đủ Scoin. Bạn có **${balance.toLocaleString('vi-VN')}**, cần **${item.price.toLocaleString('vi-VN')}**.`
            );
        }
        throw error;
    }

    // Giao hàng. Lỗi được bọc lại thành DmFailedError chỉ mang mã — xem DmFailedError.
    try {
        await user.send({
            content:
                `**${item.label}**\n${item.description}\n\n${link}\n\n` +
                `_Đơn #${orderId}. Cần lấy lại link thì dùng \`/shop redeem\`._`
        });
    } catch (error: any) {
        await refundDigitalOrder(orderId, user.id, item.price, item.key);
        throw new DmFailedError(error?.code);
    }

    await prisma.shopPurchase.update({
        where: { id: orderId },
        data: { status: 'DELIVERED', deliveredAt: new Date() }
    }).catch(() => {
        // Đơn kẹt PENDING dù link đã tới tay. Sweeper lúc khởi động sẽ dọn; ghi log
        // để lần sau biết chuyện này có xảy ra thật. Không hoàn xu ở đây — hàng đã giao.
        console.error(`[shop] đơn #${orderId} đã giao nhưng không đánh dấu được DELIVERED`);
    });

    return { label: item.label, delivered: true, alreadyOwned: false };
}

// Hoàn xu và đánh dấu REFUNDED trong CÙNG một transaction. Tách rời hai việc này
// nghĩa là có lúc xu đã hoàn mà đơn vẫn PENDING — người mua vừa có tiền lại vừa
// còn một đơn chờ giao.
async function refundDigitalOrder(orderId: number, userId: string, price: number, itemKey: string): Promise<void> {
    await prisma.$transaction(async tx => {
        await adjustScoinTx(tx, userId, price, `Hoàn xu đơn #${orderId}`, 'shop:refund', itemKey);
        await tx.shopPurchase.update({ where: { id: orderId }, data: { status: 'REFUNDED' } });
    }).catch(error => {
        // Hoàn xu thất bại là chuyện phải biết ngay: người mua đang mất xu.
        console.error(`[shop] HOÀN XU THẤT BẠI cho đơn #${orderId} (user ${userId}, ${price} scoin):`, error?.message);
    });
}

// Lấy lại link của món đã mua. Chỉ đơn DELIVERED — đơn PENDING chưa giao xong và
// đơn REFUNDED đã được hoàn xu, cả hai đều không phải bằng chứng đã trả tiền.
export async function redeemDigitalGood(
    user: { id: string; send: (payload: any) => Promise<unknown> },
    itemKey: string
): Promise<string> {
    const item = config.shop.digitalGoods.find(g => g.key === itemKey);
    if (!item) throw new Error(`Món "${itemKey}" không tồn tại.`);
    const owned = await prisma.shopPurchase.findFirst({
        where: { userId: user.id, itemKey, status: 'DELIVERED' },
        orderBy: { createdAt: 'desc' }
    });
    if (!owned) throw new Error(`Bạn chưa mua **${item.label}**.`);
    const link = digitalLink(itemKey);
    if (!link) throw new Error(`Món **${item.label}** hiện không có link. Nhắn chủ server nhé.`);

    try {
        await user.send({ content: `**${item.label}** (đơn #${owned.id})\n\n${link}` });
    } catch (error: any) {
        throw new DmFailedError(error?.code);
    }
    return item.label;
}

export function isDmFailure(error: unknown): boolean {
    return error instanceof DmFailedError;
}

// Dọn đơn PENDING treo: bot chết giữa pha 1 và pha 2 để lại đơn đã trừ xu mà chưa
// giao. Không có bước này thì người mua mất xu vĩnh viễn và không ai biết.
export async function sweepPendingDigitalOrders(): Promise<number> {
    const stale = new Date(Date.now() - 10 * 60_000);
    const pending = await prisma.shopPurchase.findMany({
        where: { status: 'PENDING', createdAt: { lt: stale } }
    }).catch(() => []);
    for (const order of pending) {
        await refundDigitalOrder(order.id, order.userId, order.price, order.itemKey);
        console.error(`[shop] đơn #${order.id} kẹt PENDING quá lâu — đã hoàn ${order.price} scoin cho ${order.userId}`);
    }
    return pending.length;
}

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
