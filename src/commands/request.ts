import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';

function requestLine(request: { id: number; kind: string; status: string; service: string; requesterId: string; claimedById: string | null }) {
    const claimed = request.claimedById ? ` -> <@${request.claimedById}>` : '';
    return `**#${request.id}** [${request.kind}/${request.status}] ${request.service} - <@${request.requesterId}>${claimed}`;
}

export default {
    data: new SlashCommandBuilder()
        .setName('request')
        .setDescription('Xem và quản lý request community')
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('Xem request gần đây')
                .addStringOption(option =>
                    option.setName('status')
                        .setDescription('Trạng thái')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Open', value: 'OPEN' },
                            { name: 'Claimed', value: 'CLAIMED' },
                            { name: 'Done', value: 'DONE' },
                            { name: 'Rated', value: 'RATED' },
                            { name: 'Closed', value: 'CLOSED' }
                        )))
        .addSubcommand(sub =>
            sub.setName('mine')
                .setDescription('Xem request của bạn'))
        .addSubcommand(sub =>
            sub.setName('stats')
                .setDescription('Thống kê request')),

    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const sub = interaction.options.getSubcommand();

        if (sub === 'stats') {
            const grouped = await prisma.requestPost.groupBy({
                by: ['status'],
                _count: { id: true }
            });
            const lines = grouped.map(row => `**${row.status}:** ${row._count.id}`).join('\n') || 'Chưa có dữ liệu.';
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#ff66cc')
                    .setTitle(`${config.ui.emojis.note} Request Stats`)
                    .setDescription(lines)]
            });
        }

        const where = sub === 'mine'
            ? { requesterId: interaction.user.id }
            : { status: interaction.options.getString('status') || 'OPEN' };

        const requests = await prisma.requestPost.findMany({
            where,
            orderBy: { updatedAt: 'desc' },
            take: 15
        });

        return interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor('#ff66cc')
                .setTitle(sub === 'mine' ? `${config.ui.emojis.customer} Request của bạn` : `${config.ui.emojis.note} Request Board`)
                .setDescription(requests.map(requestLine).join('\n') || 'Không có request phù hợp.')]
        });
    }
};
