import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, EmbedBuilder } from 'discord.js';
import { config } from '../config';
import { setBirthday, getBirthday, clearBirthday } from '../systems/birthday-manager';

// /birthday — self-service birthday registration for annual celebration + gift.
//   dat     → ngay:<1-31> thang:<1-12> — validate and save (ephemeral confirm)
//   xem     → show own entry (ephemeral)
//   xoa     → delete own entry (ephemeral confirm)
export default {
    data: new SlashCommandBuilder()
        .setName('birthday')
        .setDescription('Đăng ký sinh nhật để nhận quà từ Stella')
        .addSubcommand(sub => sub
            .setName('dat')
            .setDescription('Đặt ngày sinh nhật của bạn')
            .addIntegerOption(opt => opt
                .setName('ngay')
                .setDescription('Ngày sinh (1-31)')
                .setMinValue(1)
                .setMaxValue(31)
                .setRequired(true))
            .addIntegerOption(opt => opt
                .setName('thang')
                .setDescription('Tháng sinh (1-12)')
                .setMinValue(1)
                .setMaxValue(12)
                .setRequired(true)))
        .addSubcommand(sub => sub
            .setName('xem')
            .setDescription('Xem ngày sinh nhật đã đăng ký'))
        .addSubcommand(sub => sub
            .setName('xoa')
            .setDescription('Xoá ngày sinh nhật đã đăng ký')),

    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const sub = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        try {
            if (sub === 'dat') {
                const day = interaction.options.getInteger('ngay', true);
                const month = interaction.options.getInteger('thang', true);

                await setBirthday(userId, day, month);

                const monthName = [
                    'tháng 1', 'tháng 2', 'tháng 3', 'tháng 4', 'tháng 5', 'tháng 6',
                    'tháng 7', 'tháng 8', 'tháng 9', 'tháng 10', 'tháng 11', 'tháng 12'
                ][month - 1];

                const channel = `<#${config.birthday.channelId}>`;
                const embed = new EmbedBuilder()
                    .setColor('#ff6b9d')
                    .setTitle(`${config.ui.emojis.success} Đã lưu sinh nhật!`)
                    .setDescription(
                        `Sinh nhật của bạn: **${day} ${monthName}** 🎂\n\n` +
                        `Vào ngày sinh nhật, Stella sẽ chúc mừng bạn tại ${channel} ` +
                        `và tặng **${config.birthday.gift} Scoin**!`
                    )
                    .setFooter({ text: 'Dùng /birthday xoa để xoá nếu muốn thay đổi' });

                return interaction.editReply({ embeds: [embed] });
            }

            if (sub === 'xem') {
                const birthday = await getBirthday(userId);
                if (!birthday) {
                    return interaction.editReply({
                        content: `${config.ui.emojis.note} Bạn chưa đăng ký sinh nhật. Dùng \`/birthday dat\` để đăng ký nhé!`
                    });
                }

                const monthName = [
                    'tháng 1', 'tháng 2', 'tháng 3', 'tháng 4', 'tháng 5', 'tháng 6',
                    'tháng 7', 'tháng 8', 'tháng 9', 'tháng 10', 'tháng 11', 'tháng 12'
                ][birthday.month - 1];

                const embed = new EmbedBuilder()
                    .setColor('#ff6b9d')
                    .setTitle('🎂 Sinh nhật của bạn')
                    .setDescription(`**${birthday.day} ${monthName}**`)
                    .setFooter({ text: `Quà sinh nhật: ${config.birthday.gift} Scoin` });

                return interaction.editReply({ embeds: [embed] });
            }

            if (sub === 'xoa') {
                const birthday = await getBirthday(userId);
                if (!birthday) {
                    return interaction.editReply({
                        content: `${config.ui.emojis.note} Bạn chưa có sinh nhật nào được đăng ký.`
                    });
                }

                await clearBirthday(userId);
                return interaction.editReply({
                    content: `${config.ui.emojis.success} Đã xoá ngày sinh nhật của bạn.`
                });
            }

        } catch (error) {
            console.error('Birthday command error:', error);
            const message = error instanceof Error && error.message.includes('không hợp lệ')
                ? `${config.ui.emojis.error} ${error.message}`
                : `${config.ui.emojis.error} Có lỗi xảy ra, vui lòng thử lại sau.`;
            return interaction.editReply({ content: message });
        }
    }
};
