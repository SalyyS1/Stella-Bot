import { ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import prisma from '../lib/prisma';
import { adjustScoin, getScoinBalance, setScoin } from '../systems/scoinManager';
import { config } from '../config';

const coin = config.ui.emojis.budget || '<a:monedas:1490702767495315477>';

export default {
    data: new SlashCommandBuilder()
        .setName('scoin')
        .setDescription('Quan ly va xem Scoin')
        .addSubcommand(sub =>
            sub.setName('balance')
                .setDescription('Xem so du Scoin')
                .addUserOption(option => option.setName('user').setDescription('Nguoi can xem').setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('top')
                .setDescription('Bang xep hang Scoin'))
        .addSubcommand(sub =>
            sub.setName('history')
                .setDescription('Xem lich su Scoin gan day')
                .addUserOption(option => option.setName('user').setDescription('Nguoi can xem').setRequired(false)))
        .addSubcommandGroup(group =>
            group.setName('admin')
                .setDescription('Lenh admin Scoin')
                .addSubcommand(sub =>
                    sub.setName('add')
                        .setDescription('Cong Scoin')
                        .addUserOption(option => option.setName('user').setDescription('Nguoi nhan').setRequired(true))
                        .addIntegerOption(option => option.setName('amount').setDescription('So Scoin').setRequired(true).setMinValue(1))
                        .addStringOption(option => option.setName('reason').setDescription('Ly do').setRequired(false)))
                .addSubcommand(sub =>
                    sub.setName('remove')
                        .setDescription('Tru Scoin')
                        .addUserOption(option => option.setName('user').setDescription('Nguoi bi tru').setRequired(true))
                        .addIntegerOption(option => option.setName('amount').setDescription('So Scoin').setRequired(true).setMinValue(1))
                        .addStringOption(option => option.setName('reason').setDescription('Ly do').setRequired(false)))
                .addSubcommand(sub =>
                    sub.setName('set')
                        .setDescription('Dat lai so du Scoin')
                        .addUserOption(option => option.setName('user').setDescription('Nguoi can set').setRequired(true))
                        .addIntegerOption(option => option.setName('amount').setDescription('So du moi').setRequired(true).setMinValue(0))
                        .addStringOption(option => option.setName('reason').setDescription('Ly do').setRequired(false)))),

    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ ephemeral: interaction.options.getSubcommandGroup(false) === 'admin' });

        const group = interaction.options.getSubcommandGroup(false);
        const sub = interaction.options.getSubcommand();

        try {
            if (group === 'admin') {
                if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
                    return interaction.editReply('Ban can quyen Administrator de dung lenh nay.');
                }

                const target = interaction.options.getUser('user', true);
                const amount = interaction.options.getInteger('amount', true);
                const reason = interaction.options.getString('reason') || 'Admin adjustment';

                if (sub === 'set') {
                    const user = await setScoin(target.id, amount, reason, 'admin', `by:${interaction.user.id}`);
                    return interaction.editReply(`${coin} Da dat so du cua <@${target.id}> thanh **${user.scoinBalance.toLocaleString('vi-VN')}** Scoin.`);
                }

                const delta = sub === 'remove' ? -amount : amount;
                const user = await adjustScoin(target.id, delta, reason, 'admin', `by:${interaction.user.id}`);
                return interaction.editReply(`${coin} <@${target.id}> hien co **${user.scoinBalance.toLocaleString('vi-VN')}** Scoin.`);
            }

            if (sub === 'balance') {
                const target = interaction.options.getUser('user') || interaction.user;
                const balance = await getScoinBalance(target.id);
                const embed = new EmbedBuilder()
                    .setColor('#f1c40f')
                    .setAuthor({ name: target.username, iconURL: target.displayAvatarURL() })
                    .setTitle(`${coin} Vi Scoin`)
                    .setDescription(`<@${target.id}> dang co **${balance.toLocaleString('vi-VN')}** Scoin.`)
                    .setTimestamp();
                return interaction.editReply({ embeds: [embed] });
            }

            if (sub === 'top') {
                const top = await prisma.user.findMany({
                    orderBy: [{ scoinBalance: 'desc' }, { scoinEarnedTotal: 'desc' }],
                    take: 10
                });

                const lines = await Promise.all(top.map(async (u, index) => {
                    const user = await interaction.client.users.fetch(u.id).catch(() => null);
                    return `**#${index + 1}** ${user ? `<@${u.id}>` : u.id} - **${u.scoinBalance.toLocaleString('vi-VN')}** Scoin`;
                }));

                const embed = new EmbedBuilder()
                    .setColor('#f1c40f')
                    .setTitle(`${coin} Top Scoin`)
                    .setDescription(lines.join('\n') || 'Chua co du lieu.')
                    .setTimestamp();
                return interaction.editReply({ embeds: [embed] });
            }

            const target = interaction.options.getUser('user') || interaction.user;
            const history = await prisma.scoinTransaction.findMany({
                where: { userId: target.id },
                orderBy: { createdAt: 'desc' },
                take: 10
            });

            const embed = new EmbedBuilder()
                .setColor('#f1c40f')
                .setTitle(`${coin} Lich su Scoin`)
                .setDescription(history.map(tx =>
                    `${tx.amount > 0 ? '+' : ''}${tx.amount} - ${tx.reason} (${tx.source})`
                ).join('\n') || 'Chua co giao dich.')
                .setFooter({ text: target.username })
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        } catch (error: any) {
            console.error(error);
            return interaction.editReply(error?.message === 'Not enough Scoin.' ? 'Khong du Scoin.' : 'Da co loi khi xu ly Scoin.');
        }
    }
};
