import { AttachmentBuilder, ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import path from 'path';
import prisma from '../lib/prisma';
import { adjustScoinTx, getScoinBalance } from '../systems/scoinManager';
import { config } from '../config';

const STAR_VALUES = { dust: 2, small: 8, bright: 25, comet: 75, galaxy: 220 };
const TOOL_SHOP = [
    { key: 'silver_net', name: 'Silver Net', price: 250, note: 'Tăng cơ hội sao sáng.' },
    { key: 'galaxy_harvester', name: 'Galaxy Harvester', price: 900, note: 'Tăng sản lượng mỗi lần hái.' },
    { key: 'comet_magnet', name: 'Comet Magnet', price: 650, note: 'Tăng cơ hội comet/galaxy.' }
];
const BUFF_SHOP = [
    { key: 'stardust_tea', name: 'Stardust Tea', price: 120, note: 'Giảm cooldown trong 30 phút.' },
    { key: 'lucky_meteor', name: 'Lucky Meteor', price: 180, note: 'Tăng tier cao trong 30 phút.' },
    { key: 'double_spark', name: 'Double Spark', price: 150, note: 'Nhân đôi sao thường trong 30 phút.' }
];
const STAR_ASSETS: Record<keyof typeof STAR_VALUES, string> = {
    dust: 'star_dust.png',
    small: 'star_small.png',
    bright: 'star_bright.png',
    comet: 'star_comet.png',
    galaxy: 'star_galaxy.png'
};

function starAsset(tier: keyof typeof STAR_VALUES) {
    const name = STAR_ASSETS[tier];
    return {
        name,
        attachment: new AttachmentBuilder(path.join(process.cwd(), 'src', 'assets', 'star-game', name), { name })
    };
}

function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function pickTier(toolKeys: Set<string>, buffKeys: Set<string>): keyof typeof STAR_VALUES {
    let roll = Math.random();
    if (toolKeys.has('comet_magnet')) roll += 0.08;
    if (toolKeys.has('silver_net')) roll += 0.05;
    if (buffKeys.has('lucky_meteor')) roll += 0.12;

    if (roll > 0.985) return 'galaxy';
    if (roll > 0.92) return 'comet';
    if (roll > 0.72) return 'bright';
    if (roll > 0.35) return 'small';
    return 'dust';
}

async function getState(userId: string) {
    await prisma.user.upsert({
        where: { id: userId },
        update: {},
        create: { id: userId }
    });
    const [inventory, tools, buffs] = await Promise.all([
        prisma.starInventory.upsert({
            where: { userId },
            update: {},
            create: { userId }
        }),
        prisma.starTool.findMany({ where: { userId } }),
        prisma.starBuff.findMany({ where: { userId, expiresAt: { gt: new Date() } } })
    ]);
    return { inventory, tools, buffs };
}

export default {
    data: new SlashCommandBuilder()
        .setName('star')
        .setDescription('Minigame hái sao Stella')
        .addSubcommand(sub => sub.setName('hunt').setDescription('Đi hái sao bằng tool đang có'))
        .addSubcommand(sub => sub.setName('bag').setDescription('Xem túi sao'))
        .addSubcommand(sub => sub.setName('sell').setDescription('Bán toàn bộ sao trong túi'))
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
            if (sub === 'bag') {
                const { inventory } = await getState(userId);
                const total = inventory.dust * STAR_VALUES.dust + inventory.small * STAR_VALUES.small + inventory.bright * STAR_VALUES.bright + inventory.comet * STAR_VALUES.comet + inventory.galaxy * STAR_VALUES.galaxy;
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor('#8e44ad')
                        .setTitle(`${starEmoji} Túi sao của bạn`)
                        .setDescription(`Dust: **${inventory.dust}**\nSmall: **${inventory.small}**\nBright: **${inventory.bright}**\nComet: **${inventory.comet}**\nGalaxy: **${inventory.galaxy}**\n\nGiá trị nếu bán: **${total.toLocaleString('vi-VN')}** Scoin`)]
                });
            }

            if (sub === 'shop') {
                const buyKey = interaction.options.getString('buy');
                if (!buyKey) {
                    const lines = [
                        '**Tool vĩnh viễn**',
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
                    if (owned) return interaction.editReply('Bạn đã có tool này rồi.');
                }

                await prisma.$transaction(async tx => {
                    await tx.user.upsert({ where: { id: userId }, update: {}, create: { id: userId } });
                    const current = await tx.user.findUniqueOrThrow({ where: { id: userId } });
                    if (current.scoinBalance < item.price) throw new Error('Not enough Scoin.');
                    await tx.scoinTransaction.create({ data: { userId, amount: -item.price, reason: `Buy ${item.name}`, source: 'star:shop', metadata: item.key } });
                    await tx.user.update({ where: { id: userId }, data: { scoinBalance: { decrement: item.price } } });
                    if (tool) {
                        await tx.starTool.create({ data: { userId, key: tool.key } });
                    } else if (buff) {
                        await tx.starBuff.create({ data: { userId, key: buff.key, expiresAt: new Date(Date.now() + 30 * 60_000) } });
                    }
                });

                return interaction.editReply(`${starEmoji} Đã mua **${item.name}** thành công.`);
            }

            if (sub === 'sell') {
                const { inventory } = await getState(userId);
                const total = inventory.dust * STAR_VALUES.dust + inventory.small * STAR_VALUES.small + inventory.bright * STAR_VALUES.bright + inventory.comet * STAR_VALUES.comet + inventory.galaxy * STAR_VALUES.galaxy;
                if (total <= 0) return interaction.editReply('Túi sao đang trống.');

                const user = await prisma.$transaction(async tx => {
                    await tx.starInventory.update({
                        where: { userId },
                        data: { dust: 0, small: 0, bright: 0, comet: 0, galaxy: 0 }
                    });
                    return adjustScoinTx(tx, userId, total, 'Sell stars', 'star:sell');
                });
                return interaction.editReply(`${starEmoji} Đã bán sao và nhận **${total.toLocaleString('vi-VN')}** Scoin. Số dư: **${user.scoinBalance.toLocaleString('vi-VN')}**`);
            }

            const { inventory, tools, buffs } = await getState(userId);
            const toolKeys = new Set(tools.map(t => t.key));
            const buffKeys = new Set(buffs.map(b => b.key));
            const cooldown = buffKeys.has('stardust_tea') ? 2 * 60_000 : 5 * 60_000;
            if (inventory.lastHuntAt && Date.now() - inventory.lastHuntAt.getTime() < cooldown) {
                const left = Math.ceil((cooldown - (Date.now() - inventory.lastHuntAt.getTime())) / 1000);
                return interaction.editReply(`Chờ thêm **${left}s** rồi hái sao tiếp nhé.`);
            }

            for (const frame of ['Đang ngắm bầu trời Stella...', 'Sao băng bắt đầu rơi...', 'Đang mở lưới thu hoạch...']) {
                await interaction.editReply({ embeds: [new EmbedBuilder().setColor('#8e44ad').setTitle(`${starEmoji} Hái Sao`).setDescription(frame)] });
                await wait(700);
            }

            const tier = pickTier(toolKeys, buffKeys);
            let amount = toolKeys.has('galaxy_harvester') ? 2 : 1;
            if (buffKeys.has('double_spark') && (tier === 'dust' || tier === 'small')) amount *= 2;

            const updateData: any = { lastHuntAt: new Date(), [tier]: { increment: amount } };
            await prisma.starInventory.update({ where: { userId }, data: updateData });
            await prisma.starHarvestSession.create({
                data: { userId, toolKey: toolKeys.has('galaxy_harvester') ? 'galaxy_harvester' : toolKeys.has('silver_net') ? 'silver_net' : 'wooden_net', result: `${tier}:${amount}` }
            });

            const asset = starAsset(tier);
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#8e44ad')
                    .setTitle(`${starEmoji} Thu hoạch thành công`)
                    .setDescription(`Bạn hái được **${amount} ${tier} star**.\nDùng \`/star sell\` để bán lấy Scoin.`)
                    .setThumbnail(`attachment://${asset.name}`)],
                files: [asset.attachment]
            });
        } catch (error) {
            console.error(error);
            return interaction.editReply('Đã có lỗi khi xử lý Star Game.');
        }
    }
};
