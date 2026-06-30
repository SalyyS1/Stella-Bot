import { AttachmentBuilder, ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';
import prisma from '../lib/prisma';
import { adjustScoinTx, getScoinBalance } from '../systems/scoinManager';
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
    { key: 'rocket_drill', name: 'Rocket Drill', price: 1400, note: 'Mở khu vực Black Hole Gate.' }
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
    black_hole_gate: { name: 'Black Hole Gate', minToolLevel: 6, rareBoost: 0.18, note: 'Risk cao, loot rất ngon.' }
} as const;

const TOOL_PRIORITY = ['rocket_drill', 'galaxy_harvester', 'comet_magnet', 'silver_net', 'wooden_net'];
const huntLocks = new Map<string, number>();

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

async function getState(userId: string) {
    await prisma.user.upsert({ where: { id: userId }, update: {}, create: { id: userId } });
    await prisma.starTool.upsert({
        where: { userId_key: { userId, key: 'wooden_net' } },
        update: {},
        create: { userId, key: 'wooden_net' }
    });
    const [inventory, tools, buffs, items] = await Promise.all([
        prisma.starInventory.upsert({ where: { userId }, update: {}, create: { userId } }),
        prisma.starTool.findMany({ where: { userId } }),
        prisma.starBuff.findMany({ where: { userId, expiresAt: { gt: new Date() } } }),
        prisma.starItemStack.findMany({ where: { userId, quantity: { gt: 0 } } })
    ]);
    return { inventory, tools, buffs, items };
}

function bestTool(tools: { key: string; level: number }[]) {
    return [...tools].sort((a, b) => {
        const priority = TOOL_PRIORITY.indexOf(a.key) - TOOL_PRIORITY.indexOf(b.key);
        if (priority !== 0) return priority;
        return b.level - a.level;
    })[0] || { key: 'wooden_net', level: 1 };
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
                            { name: 'Black Hole Gate', value: 'black_hole_gate' }
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

            if (sub === 'bag' || sub === 'collection') {
                const { inventory, items } = await getState(userId);
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
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor('#8e44ad')
                        .setTitle(sub === 'bag' ? `${starEmoji} Túi sao của bạn` : `${starEmoji} Star Collection`)
                        .setDescription([...legacyLines, ...itemLines, '', `Giá trị nếu bán: **${total.toLocaleString('vi-VN')}** Scoin`].join('\n'))
                        .addFields(sub === 'collection'
                            ? [{ name: 'Còn thiếu', value: missing.map(key => ITEM_CATALOG[key].label).join(', ') || 'Đã có đủ set hiện tại!' }]
                            : [])]
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
                        '**Buff 30 phút**',
                        ...BUFF_SHOP.map(item => `\`${item.key}\` - **${item.price}** Scoin - ${item.note}`)
                    ];
                    return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#8e44ad').setTitle(`${starEmoji} Star Shop`).setDescription(lines.join('\n'))] });
                }

                const tool = TOOL_SHOP.find(item => item.key === buyKey);
                const buff = BUFF_SHOP.find(item => item.key === buyKey);
                const item = tool || buff;
                if (!item) return interaction.editReply('Không tìm thấy vật phẩm.');

                const balance = await getScoinBalance(userId);
                if (balance < item.price) return interaction.editReply('Không đủ Scoin để mua vật phẩm này.');

                if (tool) {
                    const owned = await prisma.starTool.findUnique({ where: { userId_key: { userId, key: tool.key } } });
                    if (owned) return interaction.editReply('Bạn đã có tool này rồi. Dùng `/star upgrade` để nâng cấp.');
                }

                await prisma.$transaction(async tx => {
                    await tx.user.upsert({ where: { id: userId }, update: {}, create: { id: userId } });
                    await adjustScoinTx(tx, userId, -item.price, `Buy ${item.name}`, 'star:shop', item.key);
                    if (tool) await tx.starTool.create({ data: { userId, key: tool.key } });
                    else if (buff) await tx.starBuff.create({ data: { userId, key: buff.key, expiresAt: new Date(Date.now() + 30 * 60_000) } });
                });

                return interaction.editReply(`${starEmoji} Đã mua **${item.name}** thành công.`);
            }

            if (sub === 'upgrade') {
                const key = interaction.options.getString('tool', true);
                const tool = await prisma.starTool.findUnique({ where: { userId_key: { userId, key } } });
                if (!tool) return interaction.editReply('Bạn chưa sở hữu tool này.');
                if (tool.level >= 10) return interaction.editReply('Tool này đã đạt level tối đa.');
                const cost = 180 + tool.level * tool.level * 120;
                const balance = await getScoinBalance(userId);
                if (balance < cost) return interaction.editReply(`Cần **${cost.toLocaleString('vi-VN')}** Scoin để nâng cấp.`);

                await prisma.$transaction(async tx => {
                    await adjustScoinTx(tx, userId, -cost, `Upgrade ${key}`, 'star:upgrade', `tool:${key};level:${tool.level + 1}`);
                    await tx.starTool.update({ where: { id: tool.id }, data: { level: { increment: 1 } } });
                });
                return interaction.editReply(`${starEmoji} Đã nâng **${key}** lên Lv.${tool.level + 1}.`);
            }

            if (sub === 'sell') {
                const { inventory, items } = await getState(userId);
                const total = inventoryValue(inventory, items);
                if (total <= 0) return interaction.editReply('Túi sao đang trống.');

                const user = await prisma.$transaction(async tx => {
                    await tx.starInventory.update({
                        where: { userId },
                        data: { dust: 0, small: 0, bright: 0, comet: 0, galaxy: 0 }
                    });
                    await tx.starItemStack.deleteMany({ where: { userId } });
                    return adjustScoinTx(tx, userId, total, 'Sell stars', 'star:sell');
                });
                return interaction.editReply(`${starEmoji} Đã bán sao và nhận **${total.toLocaleString('vi-VN')}** Scoin. Số dư: **${user.scoinBalance.toLocaleString('vi-VN')}**`);
            }

            const now = Date.now();
            const lockUntil = huntLocks.get(userId) || 0;
            if (lockUntil > now) return interaction.editReply('Bạn đang trong một lượt hái sao khác, chờ xíu nhé.');
            huntLocks.set(userId, now + 10_000);

            try {
                const { inventory, tools, buffs } = await getState(userId);
                const tool = bestTool(tools);
                const buffKeys = new Set(buffs.map(b => b.key));
                const areaKey = (interaction.options.getString('area') || 'stella_sky') as keyof typeof AREAS;
                const area = AREAS[areaKey] || AREAS.stella_sky;
                if (tool.level < area.minToolLevel) {
                    return interaction.editReply(`Khu vực **${area.name}** cần tool Lv.${area.minToolLevel}. Tool hiện tại của bạn là Lv.${tool.level}.`);
                }

                const event = currentEvent();
                const cooldown = buffKeys.has('stardust_tea') || event.key === 'quiet_sky' ? 2 * 60_000 : 5 * 60_000;
                if (inventory.lastHuntAt && Date.now() - inventory.lastHuntAt.getTime() < cooldown) {
                    const left = Math.ceil((cooldown - (Date.now() - inventory.lastHuntAt.getTime())) / 1000);
                    return interaction.editReply(`Chờ thêm **${left}s** rồi hái sao tiếp nhé.`);
                }

                for (const frame of [`Đang mở bản đồ ${area.name}...`, 'Sao băng bắt đầu rơi...', `Đang dùng ${tool.key} Lv.${tool.level} để thu hoạch...`]) {
                    await interaction.editReply({ embeds: [new EmbedBuilder().setColor('#8e44ad').setTitle(`${starEmoji} Hái Sao`).setDescription(frame)] });
                    await wait(700);
                }

                const itemKey = pickLoot(tool, buffKeys, areaKey);
                let amount = 1 + Math.floor(tool.level / 4);
                if (tool.key === 'galaxy_harvester') amount += 1;
                if (buffKeys.has('double_spark') && (itemKey === 'dust' || itemKey === 'small')) amount *= 2;

                await prisma.$transaction(async tx => {
                    const updateData: any = { lastHuntAt: new Date() };
                    if (isLegacyStar(itemKey)) updateData[itemKey] = { increment: amount };
                    await tx.starInventory.update({ where: { userId }, data: updateData });
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
                });

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
            return interaction.editReply('Đã có lỗi khi xử lý Star Game.');
        }
    }
};
