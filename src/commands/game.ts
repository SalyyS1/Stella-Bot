import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { settleScoinWager } from '../systems/scoinManager';
import { config } from '../config';
import { randomInt } from 'crypto';

const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 15_000;
const MIN_BET = 5;
const MAX_BET = 500;

function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function checkBet(bet: number) {
    if (bet < MIN_BET || bet > MAX_BET) throw new Error(`Cược từ ${MIN_BET} đến ${MAX_BET} Scoin.`);
}

function ensureCanPlay(userId: string, bet: number) {
    checkBet(bet);
    const now = Date.now();
    const until = cooldowns.get(userId) || 0;
    if (until > now) throw new Error(`Chờ thêm ${Math.ceil((until - now) / 1000)}s rồi chơi tiếp nhé.`);
    cooldowns.set(userId, now + COOLDOWN_MS);
}

export default {
    data: new SlashCommandBuilder()
        .setName('game')
        .setDescription('Minigame Scoin nhanh — coinflip x2, dice đúng số lời x5')
        .addSubcommand(sub =>
            sub.setName('coinflip')
                .setDescription('Lật xu đoán mặt; thắng lời bằng tiền cược')
                .addIntegerOption(option => option.setName('bet').setDescription('Số Scoin cược').setRequired(true).setMinValue(MIN_BET).setMaxValue(MAX_BET))
                .addStringOption(option =>
                    option.setName('choice')
                        .setDescription('Mặt bạn chọn')
                        .setRequired(false)
                        .addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' })))
        .addSubcommand(sub =>
            sub.setName('dice')
                .setDescription('Đoán xúc xắc 1-6; đúng số lời 5 lần tiền cược')
                .addIntegerOption(option => option.setName('bet').setDescription('Số Scoin cược').setRequired(true).setMinValue(MIN_BET).setMaxValue(MAX_BET))
                .addIntegerOption(option => option.setName('guess').setDescription('Số bạn đoán').setRequired(false).setMinValue(1).setMaxValue(6))),

    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();

        const sub = interaction.options.getSubcommand();
        const bet = interaction.options.getInteger('bet', true);
        const coin = config.ui.emojis.budget;

        try {
            ensureCanPlay(interaction.user.id, bet);

            if (sub === 'coinflip') {
                const choice = interaction.options.getString('choice') || (randomInt(2) === 0 ? 'heads' : 'tails');
                const result = randomInt(2) === 0 ? 'heads' : 'tails';
                const won = result === choice;
                const user = await settleScoinWager(
                    interaction.user.id,
                    bet,
                    won ? bet * 2 : 0,
                    won ? 'Coinflip win' : 'Coinflip lose',
                    'game:coinflip',
                    `bet:${bet};result:${result}`
                );

                const frames = ['Đồng xu đang bay...', 'Đồng xu xoay vòng...', 'Đồng xu sắp chạm đất...'];
                for (const frame of frames) {
                    await interaction.editReply({
                        embeds: [new EmbedBuilder().setColor('#f1c40f').setTitle('Coinflip').setDescription(`${coin} **${frame}**\nBạn chọn: **${choice}**`)]
                    });
                    await wait(650);
                }

                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor(won ? '#2ecc71' : '#e74c3c')
                        .setTitle(won ? 'Bạn thắng coinflip!' : 'Bạn thua coinflip')
                        .setDescription(`Kết quả: **${result}**\n${won ? '+' : '-'}**${bet}** Scoin\nSố dư: **${user.scoinBalance.toLocaleString('vi-VN')}**`)]
                });
            }

            const guess = interaction.options.getInteger('guess') || randomInt(1, 7);
            const result = randomInt(1, 7);
            const won = result === guess;
            const prize = bet * 5;
            const user = await settleScoinWager(
                interaction.user.id,
                bet,
                won ? bet + prize : 0,
                won ? 'Dice win' : 'Dice lose',
                'game:dice',
                `bet:${bet};guess:${guess};result:${result}`
            );

            for (const frame of ['Đang lắc xúc xắc...', 'Xúc xắc nảy lên...', 'Xúc xắc dừng lại...']) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor('#9b59b6').setTitle('Dice').setDescription(`${coin} **${frame}**\nBạn đoán: **${guess}**`)]
                });
                await wait(650);
            }

            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor(won ? '#2ecc71' : '#e74c3c')
                    .setTitle(won ? 'Đoán đúng xúc xắc!' : 'Đoán sai xúc xắc')
                    .setDescription(`Kết quả: **${result}**\n${won ? '+' : '-'}**${won ? prize : bet}** Scoin\nSố dư: **${user.scoinBalance.toLocaleString('vi-VN')}**`)]
            });
        } catch (error: any) {
            return interaction.editReply(error?.message === 'Not enough Scoin.' ? 'Không đủ Scoin để đặt cược.' : error?.message || 'Đã có lỗi khi chơi game.');
        }
    }
};
