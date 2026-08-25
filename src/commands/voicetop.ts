import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { config } from '../config';
import { formatVoiceTime, getVoiceLeaderboard, getVoiceStats } from '../systems/stats/voice-activity-manager';

export default {
    data: new SlashCommandBuilder()
        .setName('voicetop')
        .setDescription('Bảng xếp hạng thời gian trong voice')
        .addStringOption(option =>
            option.setName('range').setDescription('Khoảng thời gian').addChoices(
                { name: 'Tuần này', value: 'week' },
                { name: 'Từ trước tới giờ', value: 'all' }
            )),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        const range = (interaction.options.getString('range') as 'week' | 'all') || 'week';
        await interaction.deferReply();

        const rows = await getVoiceLeaderboard(range);
        if (!rows.length) {
            return interaction.editReply(`${emojis.note} Chưa có ai được ghi nhận thời gian voice ${range === 'week' ? 'tuần này' : ''}.`);
        }

        const medals = ['🥇', '🥈', '🥉'];
        const lines = rows.map((row, index) => {
            const seconds = range === 'week' ? row.weekSeconds : row.totalSeconds;
            return `${medals[index] || `**${index + 1}.**`} <@${row.userId}> — ${formatVoiceTime(seconds)}`;
        });

        // Hạng của người gọi: một bảng top 10 mà mình không có tên trong đó thì vô nghĩa
        // với chính người vừa gõ lệnh.
        const mine = await getVoiceStats(interaction.user.id);
        const mySeconds = range === 'week' ? mine.weekSeconds : mine.totalSeconds;
        const inTop = rows.some(row => row.userId === interaction.user.id);

        return interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor('#9b59b6')
                .setTitle(`🔊 Thời gian voice · ${range === 'week' ? 'tuần này' : 'từ trước tới giờ'}`)
                .setDescription(lines.join('\n'))
                .setFooter({
                    text: !inTop && mySeconds
                        ? `Của bạn: ${formatVoiceTime(mySeconds)}`
                        : 'Không tính kênh AFK và khoảng tự tắt tai nghe'
                })
                .setTimestamp()],
            allowedMentions: { parse: [] }
        });
    }
};
