import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';
import { xpToNextLevel } from '../systems/xpManager';
import { renderProfileCard } from '../systems/cardRenderer';

export default {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('Xem hồ sơ Stella của một người')
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

            const isBlacklisted = await prisma.blacklist.findUnique({ where: { id: targetUser.id } });
            const tiers = config.xp.levelTiers;
            const currentTier = tiers.find(t => user.level >= t.minLevel && user.level <= t.maxLevel);
            const tierName = currentTier?.roleName || 'Little Star';
            const tierColor = currentTier?.color || '#2ecc71';
            const xpNeeded = xpToNextLevel(user.level);
            const higherCount = await prisma.user.count({
                where: {
                    OR: [
                        { level: { gt: user.level } },
                        { level: user.level, xp: { gt: user.xp } }
                    ]
                }
            });
            const rank = higherCount + 1;

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
                tierColor: tierColor as string
            });

            const member = await interaction.guild?.members.fetch(targetUser.id).catch(() => null);
            let roleStr = '*Không có*';
            if (member) {
                const roles = member.roles.cache.filter((r: any) => r.name !== '@everyone').sort((a: any, b: any) => b.position - a.position);
                roleStr = roles.size > 0 ? roles.map((r: any) => r.toString()).slice(0, 5).join(' ') : '*Không có*';
                if (roles.size > 5) roleStr += ` (+${roles.size - 5})`;
            }

            const embed = new EmbedBuilder()
                .setColor((isBlacklisted ? '#ed4245' : tierColor) as any)
                .setImage('attachment://profile-card.png')
                .addFields(
                    {
                        name: 'Trạng thái',
                        value: `> ${isBlacklisted ? 'BLACKLISTED' : 'Bình thường'}`,
                        inline: true
                    },
                    {
                        name: 'Điểm Stella',
                        value: `> ${config.ui.emojis.expert} Chuyên gia: **${user.expertScore.toLocaleString('vi-VN')}**\n> ${config.ui.emojis.contribution} Đóng góp: **${user.contributionScore.toLocaleString('vi-VN')}**\n> ${config.ui.emojis.budget} Scoin: **${user.scoinBalance.toLocaleString('vi-VN')}**`,
                        inline: true
                    },
                    {
                        name: 'Vai trò',
                        value: `> ${roleStr}`,
                        inline: true
                    }
                )
                .setFooter({ text: 'Stella Studio - Profile', iconURL: interaction.client.user?.displayAvatarURL() })
                .setTimestamp();

            if (isBlacklisted) {
                embed.addFields({
                    name: 'Cảnh báo blacklist',
                    value: `> Lý do: \`${isBlacklisted.reason}\``,
                    inline: false
                });
            }

            await interaction.editReply({ embeds: [embed], files: [card] });
        } catch (error) {
            console.error(error);
            await interaction.editReply(`${emojis.error} Lỗi khi lấy hồ sơ.`);
        }
    }
};
