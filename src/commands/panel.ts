import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { config } from '../config';

export default {
    data: new SlashCommandBuilder()
        .setName('panel')
        .setDescription('Tạo một bảng điều khiển giao dịch trung tâm (Chỉ Admin)'),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.memberPermissions?.has('Administrator')) {
            return interaction.reply({ content: `${config.ui.emojis.error} Bạn không có quyền sử dụng lệnh này!`, flags: MessageFlags.Ephemeral });
        }

        const emojis = config.ui.emojis;

        const embed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setTitle('BẢNG ĐIỀU KHIỂN GIAO DỊCH')
            .setDescription(
                `Chào mừng bạn đến với trung tâm giao dịch của Stella Studio!\n\n` +
                `> ${emojis.budget} **Yêu Cầu Có Phí (Paid)**: Tìm người làm việc có trả công.\n` +
                `> ${emojis.service} **Yêu Cầu Hỗ Trợ (Free)**: Xin giúp đỡ, tìm team, giao lưu.\n` +
                `> ${emojis.portfolio} **Đăng Thông Tin (Portfolio)**: Show hàng sản phẩm, tìm khách hàng.\n` +
                `> ${emojis.star} **Đánh Giá (Feedback)**: Chấm điểm một người để lưu lại uy tín.\n` +
                `> ${emojis.purpleArrow} **Server Ads**: Quảng cáo Discord/Minecraft server đúng format.\n` +
                `> ${emojis.note} **Đề Xuất (Suggest)**: Gửi ý kiến đóng góp cho server.`
            )
            .setFooter({ text: 'Dữ liệu được quản lý bởi hệ thống Stella Studio', iconURL: interaction.client.user?.displayAvatarURL() });

        const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('panel_paid').setLabel('Yêu Cầu (Paid)').setStyle(ButtonStyle.Success).setEmoji(emojis.budget),
            new ButtonBuilder().setCustomId('panel_free').setLabel('Yêu Cầu (Free)').setStyle(ButtonStyle.Primary).setEmoji(emojis.service),
            new ButtonBuilder().setCustomId('panel_port').setLabel('Portfolio').setStyle(ButtonStyle.Secondary).setEmoji(emojis.portfolio),
            new ButtonBuilder().setCustomId('panel_feed').setLabel('Đánh Giá').setStyle(ButtonStyle.Danger).setEmoji(emojis.star)
        );

        const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('panel_serverads').setLabel('Server Ads').setStyle(ButtonStyle.Secondary).setEmoji(emojis.purpleArrow),
            new ButtonBuilder().setCustomId('panel_suggest').setLabel('Đề Xuất / Góp Ý').setStyle(ButtonStyle.Primary).setEmoji(emojis.note)
        );

        await (interaction.channel as any)?.send({ embeds: [embed], components: [row1, row2] });
        await interaction.reply({ content: `${emojis.success} Khởi tạo Panel thành công!`, flags: MessageFlags.Ephemeral });
    }
};
