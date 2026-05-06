import { SlashCommandBuilder, ChatInputCommandInteraction, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('portfolio')
        .setDescription('Tạo một bài đăng quảng bá bản thân (Mở Form)'),
    
    async execute(interaction: ChatInputCommandInteraction) {
        const modal = new ModalBuilder()
            .setCustomId('portfolio_modal')
            .setTitle('Quảng Bá Bản Thân');

        const nameInput = new TextInputBuilder()
            .setCustomId('name')
            .setLabel('Tên/Tuổi của bạn')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const expInput = new TextInputBuilder()
            .setCustomId('experience')
            .setLabel('Kinh nghiệm (Ví dụ: 3 năm làm model)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const serviceInput = new TextInputBuilder()
            .setCustomId('service')
            .setLabel('Dịch vụ cung cấp (Vẽ, Code, Build...)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const portfolioInput = new TextInputBuilder()
            .setCustomId('portfolio_link')
            .setLabel('Link Portfolio / Sản phẩm đã làm')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const contactInput = new TextInputBuilder()
            .setCustomId('contact')
            .setLabel('Thông tin liên hệ (Discord, FB...)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(expInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(serviceInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(portfolioInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(contactInput),
        );

        await interaction.showModal(modal);
    }
};
