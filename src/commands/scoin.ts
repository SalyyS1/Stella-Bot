import { ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import prisma from '../lib/prisma';
import { adjustScoin, getScoinBalance, setScoin } from '../systems/scoinManager';
import { config } from '../config';

const coin = config.ui.emojis.budget || '<a:monedas:1490702767495315477>';

export default {
    data: new SlashCommandBuilder()
        .setName('scoin')
        .setDescription('Quản lý và xem Scoin')
        .addSubcommand(sub =>
            sub.setName('balance')
                .setDescription('Xem số dư Scoin')
                .addUserOption(option => option.setName('user').setDescription('Người cần xem').setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('top')
                .setDescription('Bảng xếp hạng Scoin'))
        .addSubcommand(sub =>
            sub.setName('history')
                .setDescription('Xem lịch sử Scoin gần đây')
                .addUserOption(option => option.setName('user').setDescription('Người cần xem').setRequired(false)))
        .addSubcommandGroup(group =>
            group.setName('admin')
                .setDescription('Lệnh admin Scoin')
                .addSubcommand(sub =>
                    sub.setName('add')
                        .setDescription('Cộng Scoin')
                        .addUserOption(option => option.setName('user').setDescription('Người nhận').setRequired(true))
                        .addIntegerOption(option => option.setName('amount').setDescription('Số Scoin').setRequired(true).setMinValue(1))
                        .addStringOption(option => option.setName('reason').setDescription('Lý do').setRequired(false).setMaxLength(200)))
                .addSubcommand(sub =>
                    sub.setName('remove')
                        .setDescription('Trừ Scoin')
                        .addUserOption(option => option.setName('user').setDescription('Người bị trừ').setRequired(true))
                        .addIntegerOption(option => option.setName('amount').setDescription('Số Scoin').setRequired(true).setMinValue(1))
                        .addStringOption(option => option.setName('reason').setDescription('Lý do').setRequired(false).setMaxLength(200)))
                .addSubcommand(sub =>
                    sub.setName('set')
                        .setDescription('Đặt lại số dư Scoin')
                        .addUserOption(option => option.setName('user').setDescription('Người cần set').setRequired(true))
                        .addIntegerOption(option => option.setName('amount').setDescription('Số dư mới').setRequired(true).setMinValue(0))
                        .addStringOption(option => option.setName('reason').setDescription('Lý do').setRequired(false).setMaxLength(200)))),

    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ ephemeral: interaction.options.getSubcommandGroup(false) === 'admin' });

        const group = interaction.options.getSubcommandGroup(false);
        const sub = interaction.options.getSubcommand();

        try {
            if (group === 'admin') {
                if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
                    return interaction.editReply('Bạn cần quyền Administrator để dùng lệnh này.');
                }

                const target = interaction.options.getUser('user', true);
                const amount = interaction.options.getInteger('amount', true);
                const reason = interaction.options.getString('reason') || 'Admin adjustment';

                if (sub === 'set') {
                    const user = await setScoin(target.id, amount, reason, 'admin', `by:${interaction.user.id}`);
                    return interaction.editReply(`${coin} Đã đặt số dư của <@${target.id}> thành **${user.scoinBalance.toLocaleString('vi-VN')}** Scoin.`);
                }

                const delta = sub === 'remove' ? -amount : amount;
                const user = await adjustScoin(target.id, delta, reason, 'admin', `by:${interaction.user.id}`);
                return interaction.editReply(`${coin} <@${target.id}> hiện có **${user.scoinBalance.toLocaleString('vi-VN')}** Scoin.`);
            }

            if (sub === 'balance') {
                const target = interaction.options.getUser('user') || interaction.user;
                const balance = await getScoinBalance(target.id);
                const embed = new EmbedBuilder()
                    .setColor('#f1c40f')
                    .setAuthor({ name: target.username, iconURL: target.displayAvatarURL() })
                    .setTitle(`${coin} Ví Scoin`)
                    .setDescription(`<@${target.id}> đang có **${balance.toLocaleString('vi-VN')}** Scoin.`)
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
                    .setDescription(lines.join('\n') || 'Chưa có dữ liệu.')
                    .setTimestamp();
                return interaction.editReply({ embeds: [embed] });
            }

            const target = interaction.options.getUser('user') || interaction.user;
            const history = await prisma.scoinTransaction.findMany({
                where: { userId: target.id },
                orderBy: { createdAt: 'desc' },
                take: 10
            });

            const historyText = history.map(tx => {
                const reason = tx.reason.replace(/\s+/g, ' ').trim().slice(0, 200);
                const source = tx.source.replace(/\s+/g, ' ').trim().slice(0, 100);
                return `${tx.amount > 0 ? '+' : ''}${tx.amount} - ${reason} (${source})`;
            }).join('\n').slice(0, 4000) || 'Chưa có giao dịch.';
            const embed = new EmbedBuilder()
                .setColor('#f1c40f')
                .setTitle(`${coin} Lịch sử Scoin`)
                .setDescription(historyText)
                .setFooter({ text: target.username })
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        } catch (error: any) {
            console.error(error);
            return interaction.editReply(error?.message === 'Not enough Scoin.' ? 'Không đủ Scoin.' : 'Đã có lỗi khi xử lý Scoin.');
        }
    }
};
