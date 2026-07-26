import { AttachmentBuilder, ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';
import prisma from '../lib/prisma';
import { adjustScoinTx } from '../systems/scoinManager';
import { recordQuestProgress } from '../systems/quest-manager';
import { config } from '../config';

const LEGACY_STAR_VALUES = { dust: 2, small: 8, bright: 25, comet: 75, galaxy: 220 } as const;
type LegacyStar = keyof typeof LEGACY_STAR_VALUES;
type StarRarity = 'Common' | 'Rare' | 'Epic' | 'Legendary' | 'Mythic' | 'Cosmic';

const ITEM_CATALOG: Record<string, { label: string; value: number; rarity: StarRarity; asset: string }> = {
    dust: { label: 'Stardust', value: 2, rarity: 'Common', asset: 'star_dust.png' },
    small: { label: 'Small Star', value: 8, rarity: 'Common', asset: 'star_small.png' },
    bright: { label: 'Bright Star', value: 25, rarity: 'Rare', asset: 'star_bright.png' },
    comet: { label: 'Comet Star', value: 75, rarity: 'Epic', asset: 'star_comet.png' },
    galaxy: { label: 'Galaxy Star', value: 220, rarity: 'Legendary', asset: 'star_galaxy.png' },
    rainbow_star: { label: 'Rainbow Star', value: 360, rarity: 'Legendary', asset: 'all/event_04.png' },
    black_hole_core: { label: 'Black Hole Core', value: 620, rarity: 'Mythic', asset: 'effect_blackhole.png' },
    crown_star: { label: 'Crown Star', value: 950, rarity: 'Cosmic', asset: 'ui_crown.png' },
    nebula_gem: { label: 'Nebula Gem', value: 420, rarity: 'Mythic', asset: 'loot_gem.png' },
    pet_fragment: { label: 'Pet Fragment', value: 180, rarity: 'Epic', asset: 'all/pet_08.png' }
};

const TOOL_SHOP = [
    { key: 'silver_net', name: 'Silver Net', price: 250, note: 'Tăng cơ hội sao hiếm.' },
    { key: 'galaxy_harvester', name: 'Galaxy Harvester', price: 900, note: 'Tăng sản lượng mỗi lần hái.' },
    { key: 'comet_magnet', name: 'Comet Magnet', price: 650, note: 'Tăng cơ hội comet/galaxy.' },
    { key: 'rocket_drill', name: 'Rocket Drill', price: 1400, note: 'Cần nâng lên Lv.6 để vào Black Hole Gate.' }
];

const BUFF_SHOP = [
    { key: 'stardust_tea', name: 'Stardust Tea', price: 120, note: 'Giảm cooldown trong 30 phút.' },
    { key: 'lucky_meteor', name: 'Lucky Meteor', price: 180, note: 'Tăng tier cao trong 30 phút.' },
    { key: 'double_spark', name: 'Double Spark', price: 150, note: 'Nhân đôi sao thường trong 30 phút.' }
];

const AREAS = {
    stella_sky: { name: 'Stella Sky', minToolLevel: 1, rareBoost: 0, note: 'Khu vực ổn định, dễ farm.' },
    meteor_field: { name: 'Meteor Field', minToolLevel: 2, rareBoost: 0.07, note: 'Nhiều comet hơn.' },
    moon_garden: { name: 'Moon Garden', minToolLevel: 4, rareBoost: 0.12, note: 'Tăng chance gem/pet fragment.' },
    black_hole_gate: { name: 'Black Hole Gate', minToolLevel: 6, requiredToolKey: 'rocket_drill', rareBoost: 0.18, note: 'Cần Rocket Drill Lv.6, risk cao, loot rất ngon.' }
} as const;

const TOOL_PRIORITY = ['rocket_drill', 'galaxy_harvester', 'comet_magnet', 'silver_net', 'wooden_net'];
const huntLocks = new Map<string, number>();
class StarGameError extends Error {}

function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function assetPath(file: string) {
    const candidates = [
        path.join(process.cwd(), 'assets', 'star-game', file),
        path.join(process.cwd(), 'src', 'assets', 'star-game', file),
        path.join(process.cwd(), 'dist', 'assets', 'star-game', file)
    ];
    return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

function isLegacyStar(key: string): key is LegacyStar {
    return key in LEGACY_STAR_VALUES;
}

function currentEvent() {
    const now = new Date();
    const minute = now.getMinutes();
    if (minute < 15) return { key: 'meteor_shower', name: 'Meteor Shower', boost: 0.08, note: '15 phút đầu mỗi giờ tăng rare chance.' };
    if (minute >= 45) return { key: 'quiet_sky', name: 'Quiet Sky', boost: 0.02, note: 'Cuối giờ trời yên, cooldown dễ thở hơn một chút.' };
    return { key: 'normal', name: 'Normal Sky', boost: 0, note: 'Bầu trời Stella đang ổn định.' };
}

function toolName(key: string) {
    return key === 'wooden_net' ? 'Wooden Net' : TOOL_SHOP.find(tool => tool.key === key)?.name || key;
}

async function ensureStarState(userId: string) {
    await prisma.user.upsert({ where: { id: userId }, update: {}, create: { id: userId } });
    await prisma.starTool.upsert({
        where: { userId_key: { userId, key: 'wooden_net' } },
        update: {},
        create: { userId, key: 'wooden_net' }
    });
    await prisma.starInventory.upsert({ where: { userId }, update: {}, create: { userId } });
}

async function getState(userId: string) {
    await ensureStarState(userId);
    const [inventory, tools, buffs, items] = await Promise.all([
        prisma.starInventory.findUniqueOrThrow({ where: { userId } }),
        prisma.starTool.findMany({ where: { userId } }),
        prisma.starBuff.findMany({ where: { userId, expiresAt: { gt: new Date() } } }),
        prisma.starItemStack.findMany({ where: { userId, quantity: { gt: 0 } } })
    ]);
    return { inventory, tools, buffs, items };
}

function bestTool(tools: { key: string; level: number }[]) {
    return [...tools].sort((a, b) => {
        const level = b.level - a.level;
        if (level !== 0) return level;
        return TOOL_PRIORITY.indexOf(a.key) - TOOL_PRIORITY.indexOf(b.key);
    })[0] || { key: 'wooden_net', level: 1 };
}

async function lockStarUser(tx: any, userId: string) {
    await tx.user.upsert({ where: { id: userId }, update: {}, create: { id: userId } });
    // A zero increment acquires a database row lock without changing the balance.
    await tx.user.update({ where: { id: userId }, data: { scoinBalance: { increment: 0 } } });
}

async function debitScoinIfEnough(tx: any, userId: string, amount: number, reason: string, source: string, metadata?: string) {
    const charged = await tx.user.updateMany({
        where: { id: userId, scoinBalance: { gte: amount } },
        data: { scoinBalance: { decrement: amount } }
    });
    if (charged.count === 0) throw new StarGameError(`Không đủ Scoin. Cần ${amount.toLocaleString('vi-VN')} Scoin.`);
    await tx.scoinTransaction.create({ data: { userId, amount: -amount, reason, source, metadata } });
}

function pickLoot(tool: { key: string; level: number }, buffKeys: Set<string>, areaKey: keyof typeof AREAS) {
    const area = AREAS[areaKey];
    const event = currentEvent();
    let roll = Math.random() + area.rareBoost + event.boost + Math.min(0.12, tool.level * 0.012);
    if (tool.key === 'comet_magnet') roll += 0.08;
    if (tool.key === 'silver_net') roll += 0.05;
    if (tool.key === 'rocket_drill') roll += 0.10;
    if (buffKeys.has('lucky_meteor')) roll += 0.12;

    if (areaKey === 'black_hole_gate' && roll > 0.965) return 'black_hole_core';
    if (areaKey === 'moon_garden' && roll > 0.94) return Math.random() > 0.5 ? 'nebula_gem' : 'pet_fragment';
    if (roll > 1.025) return 'crown_star';
    if (roll > 0.985) return 'rainbow_star';
    if (roll > 0.955) return 'galaxy';
    if (roll > 0.88) return 'comet';
    if (roll > 0.68) return 'bright';
    if (roll > 0.32) return 'small';
    return 'dust';
}

function rarityColor(rarity: StarRarity) {
    if (rarity === 'Common') return '#8bd3ff';
    if (rarity === 'Rare') return '#56f39a';
    if (rarity === 'Epic') return '#bd7bff';
    if (rarity === 'Legendary') return '#ffd166';
    if (rarity === 'Mythic') return '#ff5c8a';
    return '#ff66cc';
}

async function renderHuntCard(data: {
    username: string;
    itemKey: string;
    amount: number;
    area: string;
    tool: string;
    toolLevel: number;
    event: string;
}) {
    const item = ITEM_CATALOG[data.itemKey];
    const W = 900;
    const H = 360;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#080924');
    bg.addColorStop(0.52, '#171044');
    bg.addColorStop(1, '#32124f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    for (let i = 0; i < 120; i++) {
        const x = Math.random() * W;
        const y = Math.random() * H;
        const r = Math.random() * 1.8;
        ctx.fillStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.55})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.roundRect(28, 28, W - 56, H - 56, 24);
    ctx.fill();

    const icon = await loadImage(assetPath(item.asset)).catch(() => null);
    if (icon) {
        ctx.drawImage(icon, 65, 72, 190, 190);
    }

    ctx.fillStyle = rarityColor(item.rarity);
    ctx.font = 'bold 24px Arial';
    ctx.fillText(item.rarity.toUpperCase(), 305, 95);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 46px Arial';
    ctx.fillText(`${item.label} x${data.amount}`, 305, 150);
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.font = '22px Arial';
    ctx.fillText(`Khu vực: ${data.area}`, 305, 200);
    ctx.fillText(`Tool: ${data.tool} Lv.${data.toolLevel}`, 305, 238);
    ctx.fillText(`Event: ${data.event}`, 305, 276);

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '18px Arial';
    ctx.fillText(`Hunter: ${data.username}`, 65, 306);

    const buffer = canvas.toBuffer('image/png');
    return new AttachmentBuilder(buffer, { name: 'star-hunt.png' });
}

function inventoryValue(inventory: any, items: { key: string; quantity: number }[]) {
    let total = 0;
    for (const [key, value] of Object.entries(LEGACY_STAR_VALUES)) {
        total += (inventory[key] || 0) * value;
    }
    for (const item of items) {
        total += (ITEM_CATALOG[item.key]?.value || 0) * item.quantity;
    }
    return total;
}

export default {
    data: new SlashCommandBuilder()
        .setName('star')
        .setDescription('Minigame hái sao Stella')
        .addSubcommand(sub =>
            sub.setName('hunt')
                .setDescription('Đi hái sao bằng tool đang có')
                .addStringOption(option =>
                    option.setName('area')
                        .setDescription('Khu vực hái sao')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Stella Sky', value: 'stella_sky' },
                            { name: 'Meteor Field', value: 'meteor_field' },
                            { name: 'Moon Garden', value: 'moon_garden' },
                            { name: 'Black Hole Gate (Rocket Drill Lv.6)', value: 'black_hole_gate' }
                        ))
                .addStringOption(option =>
                    option.setName('tool')
                        .setDescription('Tool dùng để hái (mặc định: tool level cao nhất)')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Wooden Net', value: 'wooden_net' },
                            ...TOOL_SHOP.map(item => ({ name: item.name, value: item.key }))
                        )))
        .addSubcommand(sub => sub.setName('bag').setDescription('Xem túi sao'))
        .addSubcommand(sub => sub.setName('sell').setDescription('Bán toàn bộ sao trong túi'))
        .addSubcommand(sub => sub.setName('collection').setDescription('Xem album sao đã có'))
        .addSubcommand(sub => sub.setName('event').setDescription('Xem event bầu trời hiện tại'))
        .addSubcommand(sub =>
            sub.setName('upgrade')
                .setDescription('Nâng cấp tool đang sở hữu')
                .addStringOption(option =>
                    option.setName('tool')
                        .setDescription('Tool cần nâng')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Wooden Net', value: 'wooden_net' },
                            ...TOOL_SHOP.map(item => ({ name: item.name, value: item.key }))
                        )))
        .addSubcommand(sub =>
            sub.setName('shop')
                .setDescription('Xem shop hoặc mua tool/buff')
                .addStringOption(option =>
                    option.setName('buy')
                        .setDescription('Key vật phẩm cần mua')
                        .setRequired(false)
                        .addChoices(
                            ...TOOL_SHOP.map(item => ({ name: item.name, value: item.key })),
                            ...BUFF_SHOP.map(item => ({ name: item.name, value: item.key }))
                        ))),

    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();
        const sub = interaction.options.getSubcommand();
        const userId = interaction.user.id;
        const starEmoji = config.ui.emojis.starJump;

        try {
            if (sub === 'event') {
                const event = currentEvent();
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor('#8e44ad')
                        .setTitle(`${starEmoji} ${event.name}`)
                        .setDescription(`${event.note}\nBoost hiện tại: **+${Math.round(event.boost * 100)}%** rare chance.`)]
                });
            }

            await ensureStarState(userId);

            if (sub === 'bag' || sub === 'collection') {
                const { inventory, items, tools, buffs } = await getState(userId);
                const legacyLines = Object.keys(LEGACY_STAR_VALUES).map(key => {
                    const item = ITEM_CATALOG[key];
                    return `**${item.label}:** ${(inventory as any)[key] || 0}`;
                });
                const itemLines = items.map(item => `**${ITEM_CATALOG[item.key]?.label || item.key}:** ${item.quantity}`);
                const missing = Object.keys(ITEM_CATALOG).filter(key => {
                    if (isLegacyStar(key)) return ((inventory as any)[key] || 0) <= 0;
                    return !items.some(item => item.key === key && item.quantity > 0);
                });
                const total = inventoryValue(inventory, items);
                const fields = [
                    {
                        name: 'Tools đang sở hữu',
                        value: tools
                            .sort((a, b) => b.level - a.level || TOOL_PRIORITY.indexOf(a.key) - TOOL_PRIORITY.indexOf(b.key))
                            .map(tool => `**${toolName(tool.key)}** Lv.${tool.level}`)
                            .join('\n') || 'Wooden Net Lv.1'
                    },
                    {
                        name: 'Buff đang hoạt động',
                        value: buffs.map(buff => `**${BUFF_SHOP.find(item => item.key === buff.key)?.name || buff.key}** đến <t:${Math.floor(buff.expiresAt.getTime() / 1000)}:R>`).join('\n') || 'Không có buff nào.'
                    }
                ];
                if (sub === 'collection') {
                    fields.unshift({ name: 'Còn thiếu', value: missing.map(key => ITEM_CATALOG[key].label).join(', ') || 'Đã có đủ set hiện tại!' });
                }
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor('#8e44ad')
                        .setTitle(sub === 'bag' ? `${starEmoji} Túi sao của bạn` : `${starEmoji} Star Collection`)
                        .setDescription([...legacyLines, ...itemLines, '', `Giá trị nếu bán: **${total.toLocaleString('vi-VN')}** Scoin`].join('\n'))
                        .addFields(fields)]
                });
            }

            if (sub === 'shop') {
                const buyKey = interaction.options.getString('buy');
                if (!buyKey) {
                    const lines = [
                        '**Tool vĩnh viễn**',
                        '`wooden_net` - mặc định - có thể upgrade',
                        ...TOOL_SHOP.map(item => `\`${item.key}\` - **${item.price}** Scoin - ${item.note}`),
                        '',
                        '**Yêu cầu khu vực**',
                        ...Object.values(AREAS).map(area => `**${area.name}:** ${area.note}`),
                        '',
                        '**Buff 30 phút**',
                        ...BUFF_SHOP.map(item => `\`${item.key}\` - **${item.price}** Scoin - ${item.note}`)
                    ];
                    return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#8e44ad').setTitle(`${starEmoji} Star Shop`).setDescription(lines.join('\n'))] });
                }

                const tool = TOOL_SHOP.find(item => item.key === buyKey);
                const buff = BUFF_SHOP.find(item => item.key === buyKey);
                const item = tool || buff;
                if (!item) return interaction.editReply('Không tìm thấy vật phẩm.');

                const purchase = await prisma.$transaction(async tx => {
                    await lockStarUser(tx, userId);
                    if (tool) {
                        const owned = await tx.starTool.findUnique({ where: { userId_key: { userId, key: tool.key } } });
                        if (owned) throw new StarGameError('Bạn đã có tool này rồi. Dùng `/star upgrade` để nâng cấp.');
                        await debitScoinIfEnough(tx, userId, tool.price, `Buy ${tool.name}`, 'star:shop', tool.key);
                        await tx.starTool.create({ data: { userId, key: tool.key } });
                        return { name: tool.name, extended: false };
                    }

                    const now = new Date();
                    const activeBuff = await tx.starBuff.findFirst({
                        where: { userId, key: buff!.key, expiresAt: { gt: now } },
                        orderBy: { expiresAt: 'desc' }
                    });
                    await debitScoinIfEnough(tx, userId, buff!.price, `Buy ${buff!.name}`, 'star:shop', buff!.key);
                    const expiresAt = new Date(Math.max(activeBuff?.expiresAt.getTime() || now.getTime(), now.getTime()) + 30 * 60_000);
                    if (activeBuff) {
                        await tx.starBuff.update({ where: { id: activeBuff.id }, data: { expiresAt } });
                        return { name: buff!.name, extended: true };
                    }
                    await tx.starBuff.create({ data: { userId, key: buff!.key, expiresAt } });
                    return { name: buff!.name, extended: false };
                });

                return interaction.editReply(`${starEmoji} ${purchase.extended ? 'Đã gia hạn' : 'Đã mua'} **${purchase.name}** thành công.`);
            }

            if (sub === 'upgrade') {
                const key = interaction.options.getString('tool', true);
                const upgrade = await prisma.$transaction(async tx => {
                    await lockStarUser(tx, userId);
                    const tool = await tx.starTool.findUnique({ where: { userId_key: { userId, key } } });
                    if (!tool) throw new StarGameError('Bạn chưa sở hữu tool này.');
                    if (tool.level >= 10) throw new StarGameError('Tool này đã đạt level tối đa.');
                    const cost = 180 + tool.level * tool.level * 120;
                    await debitScoinIfEnough(tx, userId, cost, `Upgrade ${key}`, 'star:upgrade', `tool:${key};level:${tool.level + 1}`);
                    const updated = await tx.starTool.updateMany({
                        where: { id: tool.id, level: tool.level },
                        data: { level: { increment: 1 } }
                    });
                    if (updated.count === 0) throw new StarGameError('Tool vừa thay đổi, vui lòng thử nâng cấp lại.');
                    return { level: tool.level + 1, cost };
                });
                return interaction.editReply(`${starEmoji} Đã nâng **${toolName(key)}** lên Lv.${upgrade.level}.`);
            }

            if (sub === 'sell') {
                const preview = await getState(userId);
                if (inventoryValue(preview.inventory, preview.items) <= 0) return interaction.editReply('Túi sao đang trống.');

                // Compute payout ONLY from rows read inside the tx, and gate the whole
                // payout on a conditional clear that matches those exact values. A second
                // concurrent sell matches count 0 (values already zeroed) and pays nothing.
                const result = await prisma.$transaction(async tx => {
                    await lockStarUser(tx, userId);
                    const inv = await tx.starInventory.findUnique({ where: { userId } });
                    if (!inv) return null;
                    const items = await tx.starItemStack.findMany({ where: { userId, quantity: { gt: 0 } } });
                    const total = inventoryValue(inv, items);
                    if (total <= 0) return null;

                    const cleared = await tx.starInventory.updateMany({
                        where: {
                            userId,
                            dust: inv.dust,
                            small: inv.small,
                            bright: inv.bright,
                            comet: inv.comet,
                            galaxy: inv.galaxy
                        },
                        data: { dust: 0, small: 0, bright: 0, comet: 0, galaxy: 0 }
                    });
                    if (cleared.count === 0) return null; // lost the race; another sell already cleared

                    // Match both id and quantity. If an external writer changed a
                    // stack, abort the tx so no newly-earned item is deleted unpaid.
                    for (const item of items) {
                        const removed = await tx.starItemStack.deleteMany({ where: { id: item.id, quantity: item.quantity } });
                        if (removed.count === 0) throw new StarGameError('Túi sao vừa thay đổi, vui lòng bán lại.');
                    }
                    const user = await adjustScoinTx(tx, userId, total, 'Sell stars', 'star:sell');
                    return { user, total };
                });

                if (!result) return interaction.editReply('Túi sao đang trống.');
                return interaction.editReply(`${starEmoji} Đã bán sao và nhận **${result.total.toLocaleString('vi-VN')}** Scoin. Số dư: **${result.user.scoinBalance.toLocaleString('vi-VN')}**`);
            }

            const now = Date.now();
            const lockUntil = huntLocks.get(userId) || 0;
            if (lockUntil > now) return interaction.editReply('Bạn đang trong một lượt hái sao khác, chờ xíu nhé.');
            huntLocks.set(userId, now + 10_000);

            try {
                const { inventory, tools, buffs } = await getState(userId);
                const requestedToolKey = interaction.options.getString('tool');
                const tool = requestedToolKey ? tools.find(candidate => candidate.key === requestedToolKey) : bestTool(tools);
                if (!tool) return interaction.editReply('Bạn chưa sở hữu tool này. Mở `/star shop` để mua tool trước.');
                const buffKeys = new Set(buffs.map(b => b.key));
                const requestedArea = interaction.options.getString('area');
                if (requestedArea && !(requestedArea in AREAS)) return interaction.editReply('Khu vực không hợp lệ.');
                const areaKey = (requestedArea || 'stella_sky') as keyof typeof AREAS;
                const area = AREAS[areaKey];
                const requiredToolKey = 'requiredToolKey' in area ? area.requiredToolKey : null;
                if (requiredToolKey && tool.key !== requiredToolKey) {
                    return interaction.editReply(`Khu vực **${area.name}** cần **${toolName(requiredToolKey)}** Lv.${area.minToolLevel}.`);
                }
                if (tool.level < area.minToolLevel) {
                    return interaction.editReply(`Khu vực **${area.name}** cần **${toolName(tool.key)}** Lv.${area.minToolLevel}. Tool bạn chọn đang Lv.${tool.level}.`);
                }

                const event = currentEvent();
                const cooldown = buffKeys.has('stardust_tea') || event.key === 'quiet_sky' ? 2 * 60_000 : 5 * 60_000;
                if (inventory.lastHuntAt && Date.now() - inventory.lastHuntAt.getTime() < cooldown) {
                    const left = Math.ceil((cooldown - (Date.now() - inventory.lastHuntAt.getTime())) / 1000);
                    return interaction.editReply(`Chờ thêm **${left}s** rồi hái sao tiếp nhé.`);
                }

                for (const frame of [`Đang mở bản đồ ${area.name}...`, 'Sao băng bắt đầu rơi...', `Đang dùng ${toolName(tool.key)} Lv.${tool.level} để thu hoạch...`]) {
                    await interaction.editReply({ embeds: [new EmbedBuilder().setColor('#8e44ad').setTitle(`${starEmoji} Hái Sao`).setDescription(frame)] });
                    await wait(700);
                }

                const itemKey = pickLoot(tool, buffKeys, areaKey);
                let amount = 1 + Math.floor(tool.level / 4);
                if (tool.key === 'galaxy_harvester') amount += 1;
                if (buffKeys.has('double_spark') && (itemKey === 'dust' || itemKey === 'small')) amount *= 2;

                const collected = await prisma.$transaction(async tx => {
                    await lockStarUser(tx, userId);
                    const harvestedAt = new Date();
                    const claimed = await tx.starInventory.updateMany({
                        where: {
                            userId,
                            OR: [
                                { lastHuntAt: null },
                                { lastHuntAt: { lte: new Date(harvestedAt.getTime() - cooldown) } }
                            ]
                        },
                        data: { lastHuntAt: harvestedAt }
                    });
                    if (claimed.count === 0) return false;
                    if (isLegacyStar(itemKey)) {
                        await tx.starInventory.update({ where: { userId }, data: { [itemKey]: { increment: amount } } });
                    }
                    if (!isLegacyStar(itemKey)) {
                        await tx.starItemStack.upsert({
                            where: { userId_key: { userId, key: itemKey } },
                            update: { quantity: { increment: amount } },
                            create: { userId, key: itemKey, quantity: amount }
                        });
                    }
                    await tx.starHarvestSession.create({
                        data: { userId, toolKey: tool.key, result: `${itemKey}:${amount}` }
                    });
                    return true;
                });
                if (!collected) {
                    const current = await prisma.starInventory.findUnique({ where: { userId }, select: { lastHuntAt: true } });
                    const left = current?.lastHuntAt ? Math.max(1, Math.ceil((cooldown - (Date.now() - current.lastHuntAt.getTime())) / 1000)) : 1;
                    return interaction.editReply(`Lượt hái sao khác vừa hoàn tất. Chờ thêm **${left}s** rồi thử lại nhé.`);
                }

                // Quest "star" counts each successful harvest (fire-and-forget).
                recordQuestProgress(userId, 'star').catch(() => {});

                const item = ITEM_CATALOG[itemKey];
                const card = await renderHuntCard({
                    username: interaction.user.username,
                    itemKey,
                    amount,
                    area: area.name,
                    tool: tool.key,
                    toolLevel: tool.level,
                    event: event.name
                });
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor(rarityColor(item.rarity))
                        .setTitle(`${starEmoji} Thu hoạch ${item.rarity}`)
                        .setDescription(`Bạn hái được **${amount} ${item.label}**.\nDùng \`/star bag\`, \`/star collection\`, hoặc \`/star sell\`.`)
                        .setImage('attachment://star-hunt.png')],
                    files: [card]
                });
            } finally {
                huntLocks.delete(userId);
            }
        } catch (error) {
            console.error(error);
            huntLocks.delete(userId);
            return interaction.editReply(error instanceof StarGameError ? error.message : 'Đã có lỗi khi xử lý Star Game.');
        }
    }
};
