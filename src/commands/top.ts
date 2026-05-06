import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';
import { xpToNextLevel } from '../systems/xpManager';

export default {
    data: new SlashCommandBuilder()
        .setName('top')
        .setDescription('Xem bảng xếp hạng hoạt động Top 10 server'),

    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();

        const emojis = config.ui.emojis;

        try {
            const topUsers = await prisma.user.findMany({
                orderBy: [
                    { level: 'desc' },
                    { xp: 'desc' }
                ],
                take: 10
            });

            // Tìm vị trí của người gọi lệnh
            const allUsers = await prisma.user.findMany({
                orderBy: [
                    { level: 'desc' },
                    { xp: 'desc' }
                ]
            });
            const myRank = allUsers.findIndex(u => u.id === interaction.user.id) + 1;
            const myData = allUsers.find(u => u.id === interaction.user.id);

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
                    `> Lv.**${u.level}** \`${bar}\` ${u.xp.toLocaleString()} XP · 💬 ${u.totalMessages.toLocaleString()} · Expert **${u.expertScore.toLocaleString('vi-VN')}** · Góp **${u.contributionScore.toLocaleString('vi-VN')}**\n`;
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
                myRankField = `> 📍 **Vị trí #${myRank}** · Lv.**${myData.level}** \`${myBar}\` ${myData.xp.toLocaleString()} XP · Expert **${myData.expertScore.toLocaleString('vi-VN')}** · Góp **${myData.contributionScore.toLocaleString('vi-VN')}**`;
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
