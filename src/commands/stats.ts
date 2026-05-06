import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';

export default {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Xem thống kê tổng quan của server'),

    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();

        const emojis = config.ui.emojis;

        try {
            const totalMembers = interaction.guild?.memberCount || 0;
            const totalFeedback = await prisma.rate.count();
            const totalUsers = await prisma.user.count();
            const totalBlacklisted = await prisma.blacklist.count();

            const msgAgg = await prisma.user.aggregate({ _sum: { totalMessages: true } });
            const totalMessages = msgAgg._sum.totalMessages || 0;
            const scoreAgg = await prisma.user.aggregate({ _sum: { expertScore: true, contributionScore: true } });
            const totalExpertScore = scoreAgg._sum.expertScore || 0;
            const totalContributionScore = scoreAgg._sum.contributionScore || 0;

            // Người uy tín nhất
            const topRated = await prisma.rate.groupBy({
                by: ['userId'],
                _avg: { stars: true },
                _count: { id: true },
                having: { id: { _count: { gte: 3 } } },
                orderBy: { _avg: { stars: 'desc' } },
                take: 1
            });

            let topRatedStr = '> *Chưa có ai đủ 3+ đánh giá*';
            if (topRated.length > 0) {
                try {
                    const user = await interaction.client.users.fetch(topRated[0].userId);
                    const stars = (topRated[0]._avg.stars || 0).toFixed(1);
                    topRatedStr = `> <@${user.id}> — **${stars}**/5 ⭐`;
                } catch { }
            }

            // Level cao nhất
            const topLevel = await prisma.user.findFirst({ orderBy: { level: 'desc' } });
            let topLevelStr = '> *Chưa có*';
            if (topLevel) {
                try {
                    const user = await interaction.client.users.fetch(topLevel.id);
                    topLevelStr = `> <@${user.id}> — Lv.**${topLevel.level}**`;
                } catch { }
            }

            // Streak dài nhất
            const topStreak = await prisma.user.findFirst({ orderBy: { dailyStreak: 'desc' } });
            let topStreakStr = '> *Chưa có*';
            if (topStreak && topStreak.dailyStreak > 0) {
                try {
                    const user = await interaction.client.users.fetch(topStreak.id);
                    topStreakStr = `> <@${user.id}> — **${topStreak.dailyStreak}** ngày`;
                } catch { }
            }

            const topExpert = await prisma.user.findFirst({ where: { expertScore: { gt: 0 } }, orderBy: { expertScore: 'desc' } });
            const topContribution = await prisma.user.findFirst({ where: { contributionScore: { gt: 0 } }, orderBy: { contributionScore: 'desc' } });
            const topExpertStr = topExpert ? `> <@${topExpert.id}> — **${topExpert.expertScore.toLocaleString('vi-VN')}** điểm` : '> *Chưa có*';
            const topContributionStr = topContribution ? `> <@${topContribution.id}> — **${topContribution.contributionScore.toLocaleString('vi-VN')}** điểm` : '> *Chưa có*';

            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setAuthor({ name: 'Stella Studio', iconURL: interaction.client.user?.displayAvatarURL() })
                .setTitle('📊 Thống Kê Server')
                .setThumbnail(interaction.guild?.iconURL({ size: 256 }) || '')
                .setDescription(`─────────────────────────`)
                .addFields(
                    {
                        name: '👥 Thành viên',
                        value: `> **${totalMembers.toLocaleString()}** người`,
                        inline: true
                    },
                    {
                        name: '💬 Tin nhắn',
                        value: `> **${totalMessages.toLocaleString()}** tin`,
                        inline: true
                    },
                    {
                        name: '⭐ Feedback',
                        value: `> **${totalFeedback.toLocaleString()}** đánh giá`,
                        inline: true
                    },
                    {
                        name: '👤 Users trong DB',
                        value: `> **${totalUsers.toLocaleString()}** user`,
                        inline: true
                    },
                    {
                        name: '🚫 Blacklisted',
                        value: `> **${totalBlacklisted.toLocaleString()}** người`,
                        inline: true
                    },
                    {
                        name: 'Điểm vote',
                        value: `> Expert: **${totalExpertScore.toLocaleString('vi-VN')}**\n> Góp: **${totalContributionScore.toLocaleString('vi-VN')}**`,
                        inline: true
                    },
                    {
                        name: '─────────────────────────',
                        value: '\u200b',
                        inline: false
                    },
                    {
                        name: '🏆 Uy tín nhất',
                        value: topRatedStr,
                        inline: true
                    },
                    {
                        name: '📈 Level cao nhất',
                        value: topLevelStr,
                        inline: true
                    },
                    {
                        name: '🔥 Streak dài nhất',
                        value: topStreakStr,
                        inline: true
                    },
                    {
                        name: 'Expert cao nhất',
                        value: topExpertStr,
                        inline: true
                    },
                    {
                        name: 'Đóng góp cao nhất',
                        value: topContributionStr,
                        inline: true
                    }
                )
                .setFooter({ text: 'Stella Studio · Thống kê Server', iconURL: interaction.client.user?.displayAvatarURL() })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error(error);
            await interaction.editReply(`${emojis.error} Lỗi khi lấy thống kê server.`);
        }
    }
};
