import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';

export default {
    data: new SlashCommandBuilder()
        .setName('feedback')
        .setDescription('Đánh giá độ uy tín của một người dùng')
        .addUserOption(option => option.setName('user').setDescription('Người bạn muốn đánh giá').setRequired(true))
        .addIntegerOption(option => option.setName('stars').setDescription('Số sao (1-5)').setRequired(true).setMinValue(1).setMaxValue(5))
        .addStringOption(option => option.setName('proof').setDescription('Link Discord hoặc URL ảnh đính kèm làm bằng chứng').setRequired(true)),
    
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const targetUser = interaction.options.getUser('user');
        const stars = interaction.options.get('stars')?.value as number;
        const proof = interaction.options.get('proof')?.value as string;
        const rater = interaction.user;

        if (!targetUser) return interaction.editReply(`${config.ui.emojis.error} Không tìm thấy user.`);

        if (targetUser.id === rater.id) {
            return interaction.editReply(`${config.ui.emojis.error} Bạn không thể tự đánh giá chính mình!`);
        }

        if (targetUser.bot) {
            return interaction.editReply(`${config.ui.emojis.error} Bạn không thể đánh giá bot!`);
        }

        try {
            await prisma.user.upsert({
                where: { id: targetUser.id },
                update: {},
                create: { id: targetUser.id }
            });

            const newRate = await prisma.rate.create({
                data: {
                    userId: targetUser.id,
                    raterId: rater.id,
                    stars,
                    proof
                }
            });

            // Lấy tổng quan đánh giá
            const aggregations = await prisma.rate.aggregate({
                where: { userId: targetUser.id },
                _avg: { stars: true },
                _count: { id: true }
            });
            const avgStars = aggregations._avg.stars ? aggregations._avg.stars.toFixed(1) : stars;
            const totalCount = aggregations._count.id;

            const feedbackChannel = interaction.client.channels.cache.get(config.channels.feedback);
            const { emojis, colors } = config.ui;
            
            const starString = emojis.star.repeat(stars) + emojis.emptyStar.repeat(5 - stars);
            const embedColor = stars >= 4 ? colors.feedbackHigh : stars <= 2 ? colors.feedbackLow : colors.feedbackMed;

            const embed = new EmbedBuilder()
                .setColor(embedColor)
                .setAuthor({ name: rater.tag, iconURL: rater.displayAvatarURL() })
                .setTitle(`Đánh giá mới cho ${targetUser.username}`)
                .setThumbnail(targetUser.displayAvatarURL())
                .addFields(
                    { name: 'Người đánh giá', value: `<@${rater.id}>`, inline: true },
                    { name: 'Người nhận', value: `<@${targetUser.id}>`, inline: true },
                    { name: 'Số sao', value: `${starString} (${stars}/5)` },
                    { name: 'Bằng chứng', value: proof },
                    { name: 'Thống kê Tổng quát', value: `Tổng số: **${totalCount} đánh giá**\nTrung bình: **${avgStars} ${emojis.star}**` }
                )
                .setTimestamp();

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(`appeal_${targetUser.id}_${newRate.id}`)
                    .setLabel('Khiếu Nại Đánh Giá')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji(emojis.appeal)
            );

            if (feedbackChannel && feedbackChannel.isTextBased()) {
                await (feedbackChannel as any).send({ embeds: [embed], components: [row] });
            } else {
                await (interaction.channel as any)?.send({ embeds: [embed], components: [row] });
            }

            await interaction.editReply(`${config.ui.emojis.success} Đã gửi đánh giá thành công!`);

        } catch (error) {
            console.error(error);
            await interaction.editReply(`${config.ui.emojis.error} Lỗi kết nối Database.`);
        }
    }
};
