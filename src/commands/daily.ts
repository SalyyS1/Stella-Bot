import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';
import { calculateDailyXp, xpToNextLevel, updateLevelRole } from '../systems/xpManager';
import { renderDailyCard } from '../systems/cardRenderer';
import { sendAdminLog } from '../utils/adminLog';
import { adjustScoin, dailyScoinReward, levelScoinReward } from '../systems/scoinManager';

export default {
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Điểm danh hàng ngày để nhận XP bonus!'),

    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();

        const userId = interaction.user.id;
        const emojis = config.ui.emojis;

        try {
            let user = await prisma.user.upsert({
                where: { id: userId },
                update: {},
                create: { id: userId }
            });

            const now = new Date();
            const lastDaily = user.lastDaily ? new Date(user.lastDaily) : null;

            // Kiểm tra đã daily hôm nay chưa
            if (lastDaily) {
                const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const lastDailyDay = new Date(lastDaily.getFullYear(), lastDaily.getMonth(), lastDaily.getDate());

                if (lastDailyDay.getTime() === todayStart.getTime()) {
                    const tomorrow = new Date(todayStart);
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    const secondsLeft = Math.floor((tomorrow.getTime() - now.getTime()) / 1000);
                    const hours = Math.floor(secondsLeft / 3600);
                    const mins = Math.floor((secondsLeft % 3600) / 60);

                    const embed = new EmbedBuilder()
                        .setColor('#e74c3c')
                        .setAuthor({ name: `${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
                        .setTitle(`❌ Đã điểm danh rồi!`)
                        .setDescription(
                            `> Bạn đã nhận thưởng hôm nay rồi.\n` +
                            `> ⏰ Quay lại sau **${hours}h ${mins}p** nhé!`
                        )
                        .setFooter({ text: `🔥 Streak hiện tại: ${user.dailyStreak} ngày` })
                        .setTimestamp();
                    return interaction.editReply({ embeds: [embed] });
                }

                // Kiểm tra streak: nếu cách > 1 ngày → reset
                const diffDays = Math.floor((todayStart.getTime() - lastDailyDay.getTime()) / (1000 * 60 * 60 * 24));
                if (diffDays > 1) {
                    user = await prisma.user.update({
                        where: { id: userId },
                        data: { dailyStreak: 0 }
                    });
                }
            }

            const newStreak = user.dailyStreak + 1;
            const xpReward = calculateDailyXp(newStreak);
            const scoinReward = dailyScoinReward(newStreak);

            // Cập nhật DB
            const updatedUser = await prisma.user.update({
                where: { id: userId },
                data: {
                    lastDaily: now,
                    dailyStreak: newStreak,
                    xp: { increment: xpReward }
                }
            });
            await adjustScoin(userId, scoinReward, `Daily streak ${newStreak}`, 'daily').catch(() => null);

            // Check level up
            const currentXp = updatedUser.xp;
            const currentLevel = updatedUser.level;
            const xpNeeded = xpToNextLevel(currentLevel);
            let leveledUp = false;
            let finalLevel = currentLevel;

            if (currentXp >= xpNeeded) {
                finalLevel = currentLevel + 1;
                const levelReward = levelScoinReward(finalLevel);
                await prisma.user.update({
                    where: { id: userId },
                    data: {
                        level: finalLevel,
                        xp: currentXp - xpNeeded
                    }
                });
                await adjustScoin(userId, levelReward, `Level ${finalLevel} reward`, 'level:daily').catch(() => null);
                leveledUp = true;

                const member = await interaction.guild?.members.fetch(userId).catch(() => null);
                if (member && interaction.guild) {
                    await updateLevelRole(interaction.guild, member, finalLevel);
                }

                const levelChannel = await interaction.client.channels.fetch(config.channels.levelUp).catch(() => null);
                if (levelChannel?.isTextBased()) {
                    const levelEmbed = new EmbedBuilder()
                        .setColor('#FFD700')
                        .setDescription(`${emojis.success} **${interaction.user.username}** vừa lên **Level ${finalLevel}** nhờ điểm danh!\n${config.ui.emojis.budget} Thưởng **${levelReward.toLocaleString('vi-VN')}** Scoin`)
                        .setFooter({ text: 'Stella Studio · Level System' })
                        .setTimestamp();
                    await (levelChannel as any).send({ content: `<@${interaction.user.id}>`, embeds: [levelEmbed] }).catch(() => {});
                }
                await sendAdminLog(interaction.client, {
                    title: 'Level up',
                    color: '#f1c40f',
                    fields: [
                        { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
                        { name: 'Level', value: `${currentLevel} -> ${finalLevel}`, inline: true },
                        { name: 'Source', value: 'Daily', inline: true }
                    ]
                });
            }

            const tomorrowXp = calculateDailyXp(newStreak + 1);
            const finalXp = leveledUp ? (currentXp - xpNeeded) : currentXp;
            const nextLevelXp = xpToNextLevel(finalLevel);

            // === RENDER IMAGE CARD ===
            const card = await renderDailyCard({
                username: interaction.user.username,
                avatarUrl: interaction.user.displayAvatarURL({ extension: 'png', size: 256 }),
                day: newStreak,
                xpReward,
                tomorrowXp,
                streak: newStreak,
                level: finalLevel,
                xp: finalXp,
                xpNeeded: nextLevelXp,
                leveledUp,
            });

            const embed = new EmbedBuilder()
                .setColor(leveledUp ? '#FFD700' : '#2ecc71')
                .setAuthor({ name: `${interaction.user.username} — Điểm danh`, iconURL: interaction.user.displayAvatarURL() })
                .setTitle('✅ Điểm danh thành công!')
                .setImage('attachment://daily-card.png')
                .setFooter({ text: '⚠️ Bỏ lỡ 1 ngày = mất streak!' })
                .setTimestamp();

            if (leveledUp) {
                embed.setDescription(`🎉 **LEVEL UP!** Bạn vừa lên **Lv.${finalLevel}**!\n${config.ui.emojis.budget} Daily +**${scoinReward.toLocaleString('vi-VN')}** Scoin`);
            } else {
                embed.setDescription(`${config.ui.emojis.budget} Daily +**${scoinReward.toLocaleString('vi-VN')}** Scoin`);
            }

            await interaction.editReply({ embeds: [embed], files: [card] });

        } catch (error) {
            console.error(error);
            await interaction.editReply(`${emojis.error} Lỗi khi xử lý điểm danh.`);
        }
    }
};
