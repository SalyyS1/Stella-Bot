import { SlashCommandBuilder, ChatInputCommandInteraction, ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle, MessageFlags } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('suggest')
        .setDescription('Gửi đề xuất / ý kiến đóng góp cho server'),

    async execute(interaction: ChatInputCommandInteraction) {
        const modal = new ModalBuilder()
            .setCustomId('suggest_modal')
            .setTitle('Gửi Đề Xuất');

        const titleInput = new TextInputBuilder()
            .setCustomId('suggest_title')
            .setLabel('Tiêu đề đề xuất')
            .setPlaceholder('Ví dụ: Thêm kênh chia sẻ resource pack...')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const descInput = new TextInputBuilder()
            .setCustomId('suggest_desc')
            .setLabel('Mô tả chi tiết')
            .setPlaceholder('Mô tả rõ hơn ý tưởng của bạn...')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(descInput)
        );

        await interaction.showModal(modal);
    }
};
