import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { config } from '../config';
import { isImageEnabled } from '../systems/imageGenClient';
import { reserveImageSlot, imageGateMessage, runImage } from '../systems/imageManager';
import { processResourcePackAsset } from '../systems/image-postprocess';

// /imagine <prompt> — AI image generation (Gemini "Nano Banana"). Gated like
// /ask (per-user cooldown + global cap) because image gen is slow and pricey.
// Optional `size` + `transparent` options post-process the result into a
// Minecraft resource-pack asset (exact square + background knocked out).
export default {
    data: new SlashCommandBuilder()
        .setName('imagine')
        .setDescription('Nhờ Stella vẽ một tấm ảnh từ mô tả của bạn')
        .addStringOption(o => o.setName('prompt').setDescription('Mô tả tấm ảnh bạn muốn').setRequired(true))
        .addIntegerOption(o => o.setName('size').setDescription('Kích thước asset resource pack (px)').addChoices(
            { name: '16x16', value: 16 },
            { name: '32x32', value: 32 },
            { name: '64x64', value: 64 },
            { name: '128x128', value: 128 },
            { name: '256x256', value: 256 }
        ))
        .addBooleanOption(o => o.setName('transparent').setDescription('Xoá nền thành trong suốt (cho icon/item)')),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!isImageEnabled()) {
            return interaction.reply({ content: `${config.ui.emojis.error} Tính năng tạo ảnh đang tắt.`, flags: MessageFlags.Ephemeral });
        }

        const prompt = interaction.options.getString('prompt', true);
        const size = interaction.options.getInteger('size');
        const transparent = interaction.options.getBoolean('transparent') ?? false;
        const assetMode = size !== null || transparent;

        // For resource-pack assets, steer the model hard toward a single readable
        // Minecraft item icon. The subject must survive downscaling to 16-32px, so
        // demand a bold silhouette, thick outline, flat colors, and high contrast —
        // a "burning sword" rendered freely turns into a red blob at 16px otherwise.
        // Background is a flat chroma green (not white: white collides with metal
        // highlights and the flood-fill would eat into the blade).
        const genPrompt = assetMode
            ? `${prompt}. Single Minecraft item icon sprite, classic pixel-art texture style, `
              + `one object only, centered, filling the frame, viewed straight-on. `
              + `Bold readable silhouette, thick dark outline, flat cel-shaded colors, `
              + `limited palette, high contrast, no gradients, no soft shadows, no realism, `
              + `no text. Solid flat chroma-key green background (#00ff00).`
            : prompt;

        // Defer FIRST, then reserve — so there is no awaited gap between reserving
        // the slot and calling runImage (which releases it). A reserve not followed
        // by runImage would leak the slot forever.
        await interaction.deferReply();
        const gate = reserveImageSlot(interaction.user.id);
        if (!gate.ok) {
            return interaction.editReply({ content: imageGateMessage(gate.reason) }).catch(() => {});
        }

        const image = await runImage(interaction.user.id, genPrompt);
        if (!image) {
            return interaction.editReply({
                content: `${config.ui.emojis.error} Stella chưa vẽ được (bị chặn nội dung hoặc lỗi tạm thời), thử mô tả khác nhé.`
            }).catch(() => {});
        }

        // Plain mode: send the raw generated image as-is.
        if (!assetMode) {
            const ext = image.mimeType.includes('jpeg') || image.mimeType.includes('jpg') ? 'jpg' : 'png';
            const file = new AttachmentBuilder(image.data, { name: `stella-imagine.${ext}` });
            const embed = new EmbedBuilder()
                .setColor('#9b59b6')
                .setDescription(`**${prompt.slice(0, 512)}**`)
                .setImage(`attachment://stella-imagine.${ext}`)
                .setFooter({ text: 'Stella • Ảnh tạo bằng AI' });
            return interaction.editReply({
                content: `<@${interaction.user.id}>`,
                embeds: [embed],
                files: [file],
                allowedMentions: { users: [interaction.user.id] }
            }).catch(() => {});
        }

        // Asset mode: post-process into a real resource-pack texture. Returns the
        // exact-size PNG (drop straight into the pack) plus a nearest-neighbor
        // preview so Discord shows crisp pixels instead of a blurry tiny PNG.
        const processed = await processResourcePackAsset(image.data, { size: size ?? undefined, transparent });
        if (!processed) {
            // Fall back to the raw image if post-processing failed.
            const file = new AttachmentBuilder(image.data, { name: 'stella-imagine.png' });
            return interaction.editReply({
                content: `<@${interaction.user.id}> ${config.ui.emojis.error} Không xử lý được thành asset, gửi ảnh gốc.`,
                files: [file],
                allowedMentions: { users: [interaction.user.id] }
            }).catch(() => {});
        }

        const dims = ` • ${processed.size}x${processed.size}`;
        const alpha = transparent ? ' • nền trong suốt' : '';
        // The .png asset is the actual texture; the preview is shown in the embed.
        const assetFile = new AttachmentBuilder(processed.asset, { name: `texture-${processed.size}x${processed.size}.png` });
        const previewFile = new AttachmentBuilder(processed.preview, { name: 'preview.png' });
        const embed = new EmbedBuilder()
            .setColor('#9b59b6')
            .setDescription(`**${prompt.slice(0, 512)}**\n\`texture-${processed.size}x${processed.size}.png\` — tải file này bỏ vào resource pack.`)
            .setImage('attachment://preview.png')
            .setFooter({ text: `Stella • Resource pack asset${dims}${alpha}` });

        await interaction.editReply({
            content: `<@${interaction.user.id}>`,
            embeds: [embed],
            files: [assetFile, previewFile],
            allowedMentions: { users: [interaction.user.id] }
        }).catch(() => {});
    }
};
