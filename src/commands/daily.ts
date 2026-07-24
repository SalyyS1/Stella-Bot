import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';
import { calculateDailyXp, xpToNextLevel, updateLevelRole } from '../systems/xpManager';
import { renderDailyCard } from '../systems/cardRenderer';
import { sendAdminLog } from '../utils/adminLog';
import { adjustScoinTx, dailyScoinReward, levelScoinReward } from '../systems/scoinManager';

export default {
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Điểm danh hàng ngày để nhận XP bonus!'),

    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();

        const userId = interaction.user.id;
        const emojis = config.ui.emojis;
        const now = new Date();
        const dayFormatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: config.maintenance.timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const dateKey = dayFormatter.format(now);

        try {
            const result = await prisma.$transaction(async tx => {
                await tx.user.upsert({ where: { id: userId }, update: {}, create: { id: userId } });
                // Lock this user's row so concurrent /daily calls cannot both claim.
                await tx.user.update({ where: { id: userId }, data: { scoinBalance: { increment: 0 } } });
                const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });

                const lastDateKey = user.lastDaily ? dayFormatter.format(user.lastDaily) : null;
                if (lastDateKey === dateKey) return { claimed: false as const, user };

                let streak = user.dailyStreak;
                if (lastDateKey) {
                    const previousDateKey = dayFormatter.format(new Date(now.getTime() - 24 * 60 * 60_000));
                    if (lastDateKey !== previousDateKey) streak = 0;
                }

                const newStreak = streak + 1;
                const xpReward = calculateDailyXp(newStreak);
                const scoinReward = dailyScoinReward(newStreak);
                const xpNeeded = xpToNextLevel(user.level);
                let finalXp = user.xp + xpReward;
                let finalLevel = user.level;
                let levelReward = 0;

                if (finalXp >= xpNeeded) {
                    finalXp -= xpNeeded;
                    finalLevel++;
                    levelReward = levelScoinReward(finalLevel);
                }

                await tx.user.update({
                    where: { id: userId },
                    data: {
                        lastDaily: now,
                        dailyStreak: newStreak,
                        xp: finalXp,
                        level: finalLevel
                    }
                });
                await adjustScoinTx(tx, userId, scoinReward, `Daily streak ${newStreak}`, 'daily');
                if (levelReward) {
                    await adjustScoinTx(tx, userId, levelReward, `Level ${finalLevel} reward`, 'level:daily');
                }

                return {
                    claimed: true as const,
                    oldLevel: user.level,
                    finalLevel,
                    finalXp,
                    newStreak,
                    xpReward,
                    scoinReward,
                    levelReward
                };
            });

            if (!result.claimed) {
                const resetParts = new Intl.DateTimeFormat('en-US', {
                    timeZone: config.maintenance.timezone,
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                }).formatToParts(now);
                const localHour = Number(resetParts.find(part => part.type === 'hour')?.value || 0) % 24;
                const localMinute = Number(resetParts.find(part => part.type === 'minute')?.value || 0);
                const minsLeft = 24 * 60 - (localHour * 60 + localMinute);
                const hours = Math.floor(minsLeft / 60);
                const mins = minsLeft % 60;
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor('#e74c3c')
                        .setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() })
                        .setTitle('❌ Đã điểm danh rồi!')
                        .setDescription(`> Bạn đã nhận thưởng hôm nay rồi.\n> ⏰ Quay lại sau **${hours}h ${mins}p** nhé!`)
                        .setFooter({ text: `🔥 Streak hiện tại: ${result.user.dailyStreak} ngày` })
                        .setTimestamp()]
                });
            }

            const leveledUp = result.finalLevel > result.oldLevel;
            if (leveledUp) {
                const member = await interaction.guild?.members.fetch(userId).catch(() => null);
                if (member && interaction.guild) await updateLevelRole(interaction.guild, member, result.finalLevel);

                const levelChannel = await interaction.client.channels.fetch(config.channels.levelUp).catch(() => null);
                if (levelChannel?.isTextBased()) {
                    await (levelChannel as any).send({
                        content: `<@${userId}>`,
                        embeds: [new EmbedBuilder()
                            .setColor('#FFD700')
                            .setDescription(`${emojis.success} **${interaction.user.username}** vừa lên **Level ${result.finalLevel}** nhờ điểm danh!\n${emojis.budget} Thưởng **${result.levelReward.toLocaleString('vi-VN')}** Scoin`)
                            .setFooter({ text: 'Stella Studio · Level System' })
                            .setTimestamp()]
                    }).catch(() => {});
                }
                await sendAdminLog(interaction.client, {
                    title: 'Level up',
                    color: '#f1c40f',
                    fields: [
                        { name: 'User', value: `<@${userId}>`, inline: true },
                        { name: 'Level', value: `${result.oldLevel} -> ${result.finalLevel}`, inline: true },
                        { name: 'Source', value: 'Daily', inline: true }
                    ]
                });
            }

            const card = await renderDailyCard({
                username: interaction.user.username,
                avatarUrl: interaction.user.displayAvatarURL({ extension: 'png', size: 256 }),
                day: result.newStreak,
                xpReward: result.xpReward,
                tomorrowXp: calculateDailyXp(result.newStreak + 1),
                streak: result.newStreak,
                level: result.finalLevel,
                xp: result.finalXp,
                xpNeeded: xpToNextLevel(result.finalLevel),
                leveledUp
            });

            const embed = new EmbedBuilder()
                .setColor(leveledUp ? '#FFD700' : '#2ecc71')
                .setAuthor({ name: `${interaction.user.username} — Điểm danh`, iconURL: interaction.user.displayAvatarURL() })
                .setTitle('✅ Điểm danh thành công!')
                .setDescription(leveledUp
                    ? `🎉 **LEVEL UP!** Bạn vừa lên **Lv.${result.finalLevel}**!\n${emojis.budget} Daily +**${result.scoinReward.toLocaleString('vi-VN')}** Scoin`
                    : `${emojis.budget} Daily +**${result.scoinReward.toLocaleString('vi-VN')}** Scoin`)
                .setImage('attachment://daily-card.png')
                .setFooter({ text: '⚠️ Bỏ lỡ 1 ngày = mất streak!' })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed], files: [card] });
        } catch (error) {
            console.error(error);
            await interaction.editReply(`${emojis.error} Lỗi khi xử lý điểm danh.`);
        }
    }
};
