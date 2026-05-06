import { SlashCommandBuilder, ChatInputCommandInteraction, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('requestpaid')
        .setDescription('Tạo một bài đăng tìm người làm việc có trả phí (Mở Form)'),
    
    async execute(interaction: ChatInputCommandInteraction) {
        const modal = new ModalBuilder()
            .setCustomId('requestpaid_modal')
            .setTitle('Yêu Cầu Có Phí (Paid)');

        const serviceInput = new TextInputBuilder()
            .setCustomId('service')
            .setLabel('Dịch vụ bạn cần (Ví dụ: Vẽ model, Code...)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const requestInput = new TextInputBuilder()
            .setCustomId('request_desc')
            .setLabel('Chi tiết yêu cầu của bạn')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        const budgetInput = new TextInputBuilder()
            .setCustomId('budget')
            .setLabel('Ngân sách (Ví dụ: 1.000.000 VNĐ)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const otherInput = new TextInputBuilder()
            .setCustomId('other')
            .setLabel('Yêu cầu khác (Tuỳ chọn)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(serviceInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(requestInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(budgetInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(otherInput),
        );

        await interaction.showModal(modal);
    }
};
