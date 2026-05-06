import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';
import { xpToNextLevel } from '../systems/xpManager';
import { renderProfileCard } from '../systems/cardRenderer';

export default {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('Xem hồ sơ toàn diện của một người')
        .addUserOption(option => option.setName('user').setDescription('Người bạn muốn xem').setRequired(false)),

    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const emojis = config.ui.emojis;

        try {
            const user = await prisma.user.upsert({
                where: { id: targetUser.id },
                update: {},
                create: { id: targetUser.id }
            });

            const rates = await prisma.rate.findMany({ where: { userId: targetUser.id } });
            const totalRates = rates.length;
            const avgStars = totalRates > 0
                ? (rates.reduce((acc, curr) => acc + curr.stars, 0) / totalRates).toFixed(1)
                : '0.0';

            const isBlacklisted = await prisma.blacklist.findUnique({ where: { id: targetUser.id } });

            // Level tier
            const tiers = config.xp.levelTiers;
            const currentTier = tiers.find(t => user.level >= t.minLevel && user.level <= t.maxLevel);
            const tierName = currentTier?.roleName || '⭐ Little Star';
            const tierColor = currentTier?.color || '#2ecc71';

            // XP info
            const xpNeeded = xpToNextLevel(user.level);

            // Rank: đếm số user có level cao hơn
            const higherCount = await prisma.user.count({
                where: {
                    OR: [
                        { level: { gt: user.level } },
                        { level: user.level, xp: { gt: user.xp } }
                    ]
                }
            });
            const rank = higherCount + 1;

            // === RENDER IMAGE CARD ===
            const card = await renderProfileCard({
                username: targetUser.username,
                avatarUrl: targetUser.displayAvatarURL({ extension: 'png', size: 512 }),
                level: user.level,
                xp: user.xp,
                xpNeeded,
                rank,
                totalMessages: user.totalMessages,
                dailyStreak: user.dailyStreak,
                tierName,
                tierColor: tierColor as string,
            });

            // Trust badge cho footer
            let trustBadge = '🔘 Thường';
            if (isBlacklisted) trustBadge = '🚫 BLACKLISTED';
            else if (totalRates >= 50 && parseFloat(avgStars) >= 4.5) trustBadge = '👑 ĐẠI THẦN';
            else if (totalRates >= 10 && parseFloat(avgStars) >= 4.0) trustBadge = '⭐ UY TÍN';
            else if (totalRates >= 5) trustBadge = '✅ Verified';

            const starString = '⭐'.repeat(Math.round(parseFloat(avgStars))) + '☆'.repeat(5 - Math.round(parseFloat(avgStars)));

            // Member info
            const member = await interaction.guild?.members.fetch(targetUser.id).catch(() => null);
            let roleStr = '*Không có*';
            if (member) {
                const roles = member.roles.cache.filter((r: any) => r.name !== '@everyone').sort((a: any, b: any) => b.position - a.position);
                roleStr = roles.size > 0 ? roles.map((r: any) => r.toString()).slice(0, 5).join(' ') : '*Không có*';
                if (roles.size > 5) roleStr += ` (+${roles.size - 5})`;
            }

            // Embed bổ sung kèm ảnh
            const embed = new EmbedBuilder()
                .setColor((isBlacklisted ? '#ed4245' : tierColor) as any)
                .setImage('attachment://profile-card.png')
                .addFields(
                    {
                        name: '⭐ Uy tín',
                        value: `> ${trustBadge}\n> ${starString} **${avgStars}**/5 (${totalRates} đánh giá)`,
                        inline: true
                    },
                    {
                        name: 'Điểm Stella',
                        value: `> ${config.ui.emojis.upvote} Chuyên gia: **${user.expertScore.toLocaleString('vi-VN')}**\n> ${config.ui.emojis.downvote} Đóng góp: **${user.contributionScore.toLocaleString('vi-VN')}**`,
                        inline: true
                    },
                    {
                        name: '📋 Vai trò',
                        value: `> ${roleStr}`,
                        inline: true
                    }
                )
                .setFooter({ text: 'Stella Studio · Profile', iconURL: interaction.client.user?.displayAvatarURL() })
                .setTimestamp();

            if (isBlacklisted) {
                embed.addFields({
                    name: '⚠️ CẢNH BÁO BLACKLIST',
                    value: `> **Lý do:** \`${isBlacklisted.reason}\`\n> Người dùng này đã bị gắn cờ **LỪA ĐẢO**.`,
                    inline: false
                });
            }

            // Auto gắn role Trusted
            if (!isBlacklisted && totalRates >= 10 && member) {
                if (!member.roles.cache.has(config.roles.trusted)) {
                    await member.roles.add(config.roles.trusted).catch(() => {});
                }
            }

            await interaction.editReply({ embeds: [embed], files: [card] });

        } catch (error) {
            console.error(error);
            await interaction.editReply(`${emojis.error} Lỗi khi lấy hồ sơ.`);
        }
    }
};
