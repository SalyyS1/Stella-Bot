import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { config } from '../config';

export default {
    data: new SlashCommandBuilder()
        .setName('panel')
        .setDescription('Tạo bảng điều khiển giao dịch trung tâm (Admin)'),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.memberPermissions?.has('Administrator')) {
            return interaction.reply({ content: `${config.ui.emojis.error} Bạn không có quyền sử dụng lệnh này.`, flags: MessageFlags.Ephemeral });
        }

        const emojis = config.ui.emojis;

        const embed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setTitle('BẢNG ĐIỀU KHIỂN GIAO DỊCH')
            .setDescription(
                `Chào mừng bạn đến với trung tâm giao dịch Stella Studio.\n\n` +
                `> ${emojis.budget} **Yêu Cầu Có Phí (Paid)**: Tìm người làm việc có trả công.\n` +
                `> ${emojis.service} **Yêu Cầu Hỗ Trợ (Free)**: Xin giúp đỡ, tìm team, giao lưu.\n` +
                `> ${emojis.portfolio} **Đăng Thông Tin (Portfolio)**: Show sản phẩm, tìm khách hàng.\n` +
                `> ${emojis.purpleArrow} **Server Ads**: Quảng cáo Discord/Minecraft server đúng format.`
            )
            .setFooter({ text: 'Stella Studio', iconURL: interaction.client.user?.displayAvatarURL() });

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('panel_paid').setLabel('Yêu Cầu (Paid)').setStyle(ButtonStyle.Success).setEmoji(emojis.budget),
            new ButtonBuilder().setCustomId('panel_free').setLabel('Yêu Cầu (Free)').setStyle(ButtonStyle.Primary).setEmoji(emojis.service),
            new ButtonBuilder().setCustomId('panel_port').setLabel('Portfolio').setStyle(ButtonStyle.Secondary).setEmoji(emojis.portfolio),
            new ButtonBuilder().setCustomId('panel_serverads').setLabel('Server Ads').setStyle(ButtonStyle.Secondary).setEmoji(emojis.purpleArrow)
        );

        await (interaction.channel as any)?.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: `${emojis.success} Đã tạo panel thành công.`, flags: MessageFlags.Ephemeral });
    }
};
