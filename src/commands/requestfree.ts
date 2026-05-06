import { SlashCommandBuilder, ChatInputCommandInteraction, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('requestfree')
        .setDescription('Tạo bài đăng tìm người giúp đỡ miễn phí (Mở Form)'),
    
    async execute(interaction: ChatInputCommandInteraction) {
        const modal = new ModalBuilder()
            .setCustomId('requestfree_modal')
            .setTitle('Yêu Cầu Giúp Đỡ (Free)');

        const serviceInput = new TextInputBuilder()
            .setCustomId('service')
            .setLabel('Bạn đang cần giúp đỡ việc gì?')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const requestInput = new TextInputBuilder()
            .setCustomId('request_desc')
            .setLabel('Chi tiết về điều bạn cần giúp đỡ')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        const otherInput = new TextInputBuilder()
            .setCustomId('other')
            .setLabel('Thông tin liên hệ / Khác (Tuỳ chọn)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(serviceInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(requestInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(otherInput),
        );

        await interaction.showModal(modal);
    }
};
