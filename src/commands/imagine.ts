import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { config } from '../config';
import { isImageEnabled } from '../systems/imageGenClient';
import { reserveImageSlot, imageGateMessage, runImage } from '../systems/imageManager';

// /imagine <prompt> — AI image generation (Gemini "Nano Banana"). Gated like
// /ask (per-user cooldown + global cap) because image gen is slow and pricey.
export default {
    data: new SlashCommandBuilder()
        .setName('imagine')
        .setDescription('Nhờ Stella vẽ một tấm ảnh từ mô tả của bạn')
        .addStringOption(o => o.setName('prompt').setDescription('Mô tả tấm ảnh bạn muốn').setRequired(true)),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!isImageEnabled()) {
            return interaction.reply({ content: `${config.ui.emojis.error} Tính năng tạo ảnh đang tắt.`, flags: MessageFlags.Ephemeral });
        }

        const prompt = interaction.options.getString('prompt', true);
        // Defer FIRST, then reserve — so there is no awaited gap between reserving
        // the slot and calling runImage (which releases it). A reserve not followed
        // by runImage would leak the slot forever.
        await interaction.deferReply();
        const gate = reserveImageSlot(interaction.user.id);
        if (!gate.ok) {
            return interaction.editReply({ content: imageGateMessage(gate.reason) }).catch(() => {});
        }

        const image = await runImage(interaction.user.id, prompt);
        if (!image) {
            return interaction.editReply({
                content: `${config.ui.emojis.error} Stella chưa vẽ được (bị chặn nội dung hoặc lỗi tạm thời), thử mô tả khác nhé.`
            }).catch(() => {});
        }

        const ext = image.mimeType.includes('jpeg') || image.mimeType.includes('jpg') ? 'jpg' : 'png';
        const file = new AttachmentBuilder(image.data, { name: `stella-imagine.${ext}` });
        const embed = new EmbedBuilder()
            .setColor('#9b59b6')
            .setDescription(`**${prompt.slice(0, 512)}**`)
            .setImage(`attachment://stella-imagine.${ext}`)
            .setFooter({ text: 'Stella • Ảnh tạo bằng AI' });

        await interaction.editReply({
            content: `<@${interaction.user.id}>`,
            embeds: [embed],
            files: [file],
            allowedMentions: { users: [interaction.user.id] }
        }).catch(() => {});
    }
};
