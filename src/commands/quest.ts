import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { config } from '../config';
import { getQuestBoard } from '../systems/quest-manager';

export default {
    data: new SlashCommandBuilder()
        .setName('quest')
        .setDescription('Xem nhiệm vụ ngày và tiến độ của bạn'),

    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const userId = interaction.user.id;
        const emojis = config.ui.emojis;

        try {
            const board = await getQuestBoard(userId);

            // Build quest list with progress indicators
            const questLines = board.quests.map(q => {
                const icon = q.completed ? '✅' : '⬜';
                const progressBar = `${q.progress}/${q.target}`;
                const reward = `+${q.reward.toLocaleString('vi-VN')} ${emojis.budget}`;
                return `${icon} ${q.emoji} **${q.label}**\n└ Tiến độ: ${progressBar} · Thưởng: ${reward}`;
            }).join('\n\n');

            // Bonus amount comes from quest-manager (paid amount, or projection
            // with the streak the user will have on completing today).
            const allCompleted = board.quests.every(q => q.completed);
            const bonus = board.todayBonus;

            const streakLine = `🔥 **Chuỗi ngày hoàn thành:** ${board.streak} ngày`;
            const bonusLine = board.bonusPaidToday
                ? `✨ **Đã hoàn thành tất cả nhiệm vụ hôm nay!**\n└ Bonus đã nhận: +${bonus.toLocaleString('vi-VN')} ${emojis.budget}`
                : `✨ **Hoàn thành tất cả để nhận bonus:** +${bonus.toLocaleString('vi-VN')} ${emojis.budget}`;

            const embed = new EmbedBuilder()
                .setColor(allCompleted ? '#2ecc71' : '#3498db')
                .setAuthor({
                    name: `${interaction.user.username} — Nhiệm vụ ngày`,
                    iconURL: interaction.user.displayAvatarURL()
                })
                .setTitle('📋 Bảng nhiệm vụ hôm nay')
                .setDescription(`${questLines}\n\n${streakLine}\n${bonusLine}`)
                .setFooter({ text: '💡 Hoàn thành nhiệm vụ để nhận Scoin!' })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await interaction.editReply(`${emojis.error} Lỗi khi tải nhiệm vụ.`);
        }
    }
};
