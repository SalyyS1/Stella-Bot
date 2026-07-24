import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';
import { xpToNextLevel } from '../systems/xpManager';
import { getFreelancerLeaderboard } from '../systems/freelancerManager';

export default {
    data: new SlashCommandBuilder()
        .setName('top')
        .setDescription('Xem bảng xếp hạng server')
        .addStringOption(option =>
            option
                .setName('type')
                .setDescription('Loại bảng xếp hạng')
                .setRequired(false)
                .addChoices(
                    { name: 'Hoạt động (Level + XP)', value: 'activity' },
                    { name: 'Freelancer (rating + jobs)', value: 'freelancers' }
                )
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();

        const emojis = config.ui.emojis;

        if (interaction.options.getString('type') === 'freelancers') {
            try {
                const ranks = await getFreelancerLeaderboard(10);
                if (!ranks.length) {
                    return interaction.editReply(`${emojis.emptyStar} Chưa có freelancer nào đủ số lượt đánh giá để lên bảng (cần tối thiểu 3 review).`);
                }
                const medals = ['🥇', '🥈', '🥉'];
                let board = '';
                for (let i = 0; i < ranks.length; i++) {
                    const r = ranks[i];
                    let username = 'Unknown';
                    try { username = (await interaction.client.users.fetch(r.userId)).username; } catch { }
                    const medal = medals[i] || `\`#${i + 1}\``;
                    board += `${medal} **${username}** · ${emojis.star} ${r.avgRating.toFixed(2)}/5 · ${r.jobCount} job\n`;
                }
                const embed = new EmbedBuilder()
                    .setColor('#57f287')
                    .setAuthor({ name: 'Stella Studio', iconURL: interaction.client.user?.displayAvatarURL() })
                    .setTitle('🏆 Bảng Xếp Hạng Freelancer')
                    .setDescription(board)
                    .setFooter({ text: 'Xếp theo điểm đánh giá trung bình · tối thiểu 3 review' })
                    .setTimestamp();
                return interaction.editReply({ embeds: [embed] });
            } catch (error) {
                console.error(error);
                return interaction.editReply(`${emojis.error} Lỗi khi lấy bảng xếp hạng freelancer.`);
            }
        }

        try {
            const topUsers = await prisma.user.findMany({
                orderBy: [
                    { level: 'desc' },
                    { xp: 'desc' }
                ],
                take: 10
            });

            const myData = await prisma.user.findUnique({
                where: { id: interaction.user.id }
            });
            const myRank = myData
                ? await prisma.user.count({
                    where: {
                        OR: [
                            { level: { gt: myData.level } },
                            { level: myData.level, xp: { gt: myData.xp } }
                        ]
                    }
                }) + 1
                : 0;

            const medals = ['🥇', '🥈', '🥉'];
            let leaderboard = '';

            for (let i = 0; i < topUsers.length; i++) {
                const u = topUsers[i];
                const medal = medals[i] || `\`#${i + 1}\``;
                let username = 'Unknown';
                try {
                    const discordUser = await interaction.client.users.fetch(u.id);
                    username = discordUser.username;
                } catch { }

                const xpNeeded = xpToNextLevel(u.level);
                const progress = Math.min(u.xp / xpNeeded, 1);
                const barLen = 8;
                const filled = Math.round(progress * barLen);
                const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);

                leaderboard += `${medal} **${username}**\n` +
                    `> Lv.**${u.level}** \`${bar}\` ${u.xp.toLocaleString()} XP · 💬 ${u.totalMessages.toLocaleString()} · ${emojis.expert} Chuyên gia **${u.expertScore.toLocaleString('vi-VN')}** · ${emojis.contribution} Đóng góp **${u.contributionScore.toLocaleString('vi-VN')}**\n`;
            }

            if (!leaderboard) leaderboard = '*Chưa có dữ liệu...*';

            // Rank người dùng
            let myRankField = '📍 Bạn chưa có dữ liệu hoạt động.';
            if (myData) {
                const myXpNeeded = xpToNextLevel(myData.level);
                const myProgress = Math.min(myData.xp / myXpNeeded, 1);
                const myBarLen = 10;
                const myFilled = Math.round(myProgress * myBarLen);
                const myBar = '█'.repeat(myFilled) + '░'.repeat(myBarLen - myFilled);
                myRankField = `> 📍 **Vị trí #${myRank}** · Lv.**${myData.level}** \`${myBar}\` ${myData.xp.toLocaleString()} XP · ${emojis.expert} Chuyên gia **${myData.expertScore.toLocaleString('vi-VN')}** · ${emojis.contribution} Đóng góp **${myData.contributionScore.toLocaleString('vi-VN')}**`;
            }

            const embed = new EmbedBuilder()
                .setColor('#FFD700')
                .setAuthor({ name: 'Stella Studio', iconURL: interaction.client.user?.displayAvatarURL() })
                .setTitle('🏆 Bảng Xếp Hạng Hoạt Động')
                .setThumbnail(interaction.guild?.iconURL({ size: 256 }) || '')
                .setDescription(leaderboard)
                .addFields(
                    {
                        name: '─────────────────────────',
                        value: myRankField,
                        inline: false
                    }
                )
                .setFooter({ text: 'Xếp hạng theo Level + XP · Cập nhật realtime', iconURL: interaction.client.user?.displayAvatarURL() })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error(error);
            await interaction.editReply(`${emojis.error} Lỗi khi lấy bảng xếp hạng.`);
        }
    }
};
