import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';

export default {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Xem thong ke tong quan cua server'),

    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();
        const emojis = config.ui.emojis;

        try {
            const totalMembers = interaction.guild?.memberCount || 0;
            const totalUsers = await prisma.user.count();
            const totalBlacklisted = await prisma.blacklist.count();
            const msgAgg = await prisma.user.aggregate({ _sum: { totalMessages: true } });
            const scoreAgg = await prisma.user.aggregate({ _sum: { expertScore: true, contributionScore: true } });
            const totalMessages = msgAgg._sum.totalMessages || 0;
            const totalExpertScore = scoreAgg._sum.expertScore || 0;
            const totalContributionScore = scoreAgg._sum.contributionScore || 0;

            const topLevel = await prisma.user.findFirst({ orderBy: { level: 'desc' } });
            const topStreak = await prisma.user.findFirst({ orderBy: { dailyStreak: 'desc' } });
            const topExpert = await prisma.user.findFirst({ where: { expertScore: { gt: 0 } }, orderBy: { expertScore: 'desc' } });
            const topContribution = await prisma.user.findFirst({ where: { contributionScore: { gt: 0 } }, orderBy: { contributionScore: 'desc' } });

            const topLevelStr = topLevel ? `> <@${topLevel.id}> - Lv.**${topLevel.level}**` : '> *Chua co*';
            const topStreakStr = topStreak && topStreak.dailyStreak > 0 ? `> <@${topStreak.id}> - **${topStreak.dailyStreak}** ngay` : '> *Chua co*';
            const topExpertStr = topExpert ? `> <@${topExpert.id}> - **${topExpert.expertScore.toLocaleString('vi-VN')}** diem` : '> *Chua co*';
            const topContributionStr = topContribution ? `> <@${topContribution.id}> - **${topContribution.contributionScore.toLocaleString('vi-VN')}** diem` : '> *Chua co*';

            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setAuthor({ name: 'Stella Studio', iconURL: interaction.client.user?.displayAvatarURL() })
                .setTitle('Thong Ke Server')
                .setThumbnail(interaction.guild?.iconURL({ size: 256 }) || '')
                .addFields(
                    { name: 'Thanh vien', value: `> **${totalMembers.toLocaleString()}** nguoi`, inline: true },
                    { name: 'Tin nhan', value: `> **${totalMessages.toLocaleString()}** tin`, inline: true },
                    { name: 'Users trong DB', value: `> **${totalUsers.toLocaleString()}** user`, inline: true },
                    { name: 'Blacklisted', value: `> **${totalBlacklisted.toLocaleString()}** nguoi`, inline: true },
                    { name: 'Diem vote', value: `> Expert: **${totalExpertScore.toLocaleString('vi-VN')}**\n> Gop: **${totalContributionScore.toLocaleString('vi-VN')}**`, inline: true },
                    { name: 'Level cao nhat', value: topLevelStr, inline: true },
                    { name: 'Streak dai nhat', value: topStreakStr, inline: true },
                    { name: 'Expert cao nhat', value: topExpertStr, inline: true },
                    { name: 'Dong gop cao nhat', value: topContributionStr, inline: true }
                )
                .setFooter({ text: 'Stella Studio - Stats', iconURL: interaction.client.user?.displayAvatarURL() })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await interaction.editReply(`${emojis.error} Loi khi lay thong ke server.`);
        }
    }
};
