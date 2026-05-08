import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { adjustScoin, getScoinBalance } from '../systems/scoinManager';
import { config } from '../config';

const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 15_000;
const MIN_BET = 5;
const MAX_BET = 500;

function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function checkBet(bet: number) {
    if (bet < MIN_BET || bet > MAX_BET) throw new Error(`Cuoc tu ${MIN_BET} den ${MAX_BET} Scoin.`);
}

async function ensureCanPlay(userId: string, bet: number) {
    checkBet(bet);
    const now = Date.now();
    const until = cooldowns.get(userId) || 0;
    if (until > now) throw new Error(`Cho them ${Math.ceil((until - now) / 1000)}s roi choi tiep nhe.`);
    const balance = await getScoinBalance(userId);
    if (balance < bet) throw new Error('Khong du Scoin de dat cuoc.');
    cooldowns.set(userId, now + COOLDOWN_MS);
}

export default {
    data: new SlashCommandBuilder()
        .setName('game')
        .setDescription('Minigame Scoin nhanh')
        .addSubcommand(sub =>
            sub.setName('coinflip')
                .setDescription('Lat xu doan mat')
                .addIntegerOption(option => option.setName('bet').setDescription('So Scoin cuoc').setRequired(true).setMinValue(MIN_BET).setMaxValue(MAX_BET))
                .addStringOption(option =>
                    option.setName('choice')
                        .setDescription('Mat ban chon')
                        .setRequired(false)
                        .addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' })))
        .addSubcommand(sub =>
            sub.setName('dice')
                .setDescription('Doan xuc xac 1-6')
                .addIntegerOption(option => option.setName('bet').setDescription('So Scoin cuoc').setRequired(true).setMinValue(MIN_BET).setMaxValue(MAX_BET))
                .addIntegerOption(option => option.setName('guess').setDescription('So ban doan').setRequired(false).setMinValue(1).setMaxValue(6))),

    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();

        const sub = interaction.options.getSubcommand();
        const bet = interaction.options.getInteger('bet', true);
        const coin = config.ui.emojis.budget;

        try {
            await ensureCanPlay(interaction.user.id, bet);

            if (sub === 'coinflip') {
                const choice = interaction.options.getString('choice') || (Math.random() > 0.5 ? 'heads' : 'tails');
                const frames = ['Dong xu dang bay...', 'Dong xu xoay vong...', 'Dong xu sap cham dat...'];
                for (const frame of frames) {
                    await interaction.editReply({
                        embeds: [new EmbedBuilder().setColor('#f1c40f').setTitle('Coinflip').setDescription(`${coin} **${frame}**\nBan chon: **${choice}**`)]
                    });
                    await wait(650);
                }

                const result = Math.random() > 0.5 ? 'heads' : 'tails';
                const won = result === choice;
                const delta = won ? bet : -bet;
                const user = await adjustScoin(interaction.user.id, delta, won ? 'Coinflip win' : 'Coinflip lose', 'game:coinflip', `bet:${bet};result:${result}`);

                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor(won ? '#2ecc71' : '#e74c3c')
                        .setTitle(won ? 'Ban thang coinflip!' : 'Ban thua coinflip')
                        .setDescription(`Ket qua: **${result}**\n${won ? '+' : '-'}**${bet}** Scoin\nSo du: **${user.scoinBalance.toLocaleString('vi-VN')}**`)]
                });
            }

            const guess = interaction.options.getInteger('guess') || Math.floor(Math.random() * 6) + 1;
            for (const frame of ['Dang lac xuc xac...', 'Xuc xac nay len...', 'Xuc xac dung lai...']) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor('#9b59b6').setTitle('Dice').setDescription(`${coin} **${frame}**\nBan doan: **${guess}**`)]
                });
                await wait(650);
            }

            const result = Math.floor(Math.random() * 6) + 1;
            const won = result === guess;
            const prize = bet * 5;
            const delta = won ? prize : -bet;
            const user = await adjustScoin(interaction.user.id, delta, won ? 'Dice win' : 'Dice lose', 'game:dice', `bet:${bet};guess:${guess};result:${result}`);

            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor(won ? '#2ecc71' : '#e74c3c')
                    .setTitle(won ? 'Doan dung xuc xac!' : 'Doan sai xuc xac')
                    .setDescription(`Ket qua: **${result}**\n${won ? '+' : '-'}**${won ? prize : bet}** Scoin\nSo du: **${user.scoinBalance.toLocaleString('vi-VN')}**`)]
            });
        } catch (error: any) {
            cooldowns.delete(interaction.user.id);
            return interaction.editReply(error?.message || 'Da co loi khi choi game.');
        }
    }
};
