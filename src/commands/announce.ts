import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import {
    buildAnnouncementEmbed,
    createPendingAnnouncement,
    previewButtons
} from '../systems/announceManager';

function normalizeColor(color: string | null): string | null {
    if (!color) return null;
    const value = color.startsWith('#') ? color : `#${color}`;
    return /^#[0-9a-f]{6}$/i.test(value) ? value : null;
}

function normalizeHttpUrl(value: string | null): string | null {
    if (!value) return null;
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
    } catch {
        return null;
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Tạo thông báo embed cho admin')
        .addSubcommand(sub =>
            sub.setName('create')
                .setDescription('Tạo preview thông báo trước khi gửi')
                .addChannelOption(option => option.setName('channel').setDescription('Kênh cần gửi').setRequired(true))
                .addStringOption(option => option.setName('title').setDescription('Tiêu đề').setRequired(true).setMaxLength(200))
                .addStringOption(option => option.setName('description').setDescription('Nội dung').setRequired(true).setMaxLength(2000))
                .addRoleOption(option => option.setName('ping_role').setDescription('Role cần ping').setRequired(false))
                .addStringOption(option => option.setName('color').setDescription('Màu hex, VD ff66cc').setRequired(false))
                .addStringOption(option => option.setName('emoji').setDescription('Emoji/icon đầu title').setRequired(false).setMaxLength(50))
                .addStringOption(option => option.setName('image').setDescription('Ảnh/banner URL').setRequired(false))
                .addStringOption(option => option.setName('thumbnail').setDescription('Thumbnail URL').setRequired(false))
                .addStringOption(option => option.setName('footer').setDescription('Footer').setRequired(false).setMaxLength(200))
                .addStringOption(option => option.setName('button_label').setDescription('Label nút link').setRequired(false).setMaxLength(80))
                .addStringOption(option => option.setName('button_url').setDescription('URL nút link').setRequired(false))),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'Bạn cần quyền Administrator để tạo thông báo.', flags: MessageFlags.Ephemeral });
        }

        const sub = interaction.options.getSubcommand();
        if (sub !== 'create') return;

        const channel = interaction.options.getChannel('channel', true);
        if (!(channel as any).isTextBased?.()) {
            return interaction.reply({ content: 'Kênh gửi thông báo không hợp lệ.', flags: MessageFlags.Ephemeral });
        }
        const permissions = interaction.guild?.members.me
            ? (channel as any).permissionsFor?.(interaction.guild.members.me)
            : null;
        if (!permissions?.has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks
        ])) {
            return interaction.reply({ content: 'Stella cần quyền View Channel, Send Messages và Embed Links tại kênh đích.', flags: MessageFlags.Ephemeral });
        }

        const color = normalizeColor(interaction.options.getString('color'));
        if (interaction.options.getString('color') && !color) {
            return interaction.reply({ content: 'Màu hex không hợp lệ. VD: ff66cc hoặc #ff66cc.', flags: MessageFlags.Ephemeral });
        }

        const imageInput = interaction.options.getString('image');
        const thumbnailInput = interaction.options.getString('thumbnail');
        const buttonLabel = interaction.options.getString('button_label');
        const buttonInput = interaction.options.getString('button_url');
        if ((buttonLabel && !buttonInput) || (!buttonLabel && buttonInput)) {
            return interaction.reply({ content: 'Nút link cần có cả label và URL.', flags: MessageFlags.Ephemeral });
        }
        const imageUrl = normalizeHttpUrl(imageInput);
        const thumbnailUrl = normalizeHttpUrl(thumbnailInput);
        const buttonUrl = normalizeHttpUrl(buttonInput);
        if ((imageInput && !imageUrl) || (thumbnailInput && !thumbnailUrl) || (buttonInput && !buttonUrl)) {
            return interaction.reply({ content: 'URL ảnh, thumbnail và nút link phải dùng HTTP hoặc HTTPS hợp lệ.', flags: MessageFlags.Ephemeral });
        }

        const data = createPendingAnnouncement({
            creatorId: interaction.user.id,
            channelId: channel.id,
            roleId: interaction.options.getRole('ping_role')?.id || null,
            title: interaction.options.getString('title', true),
            description: interaction.options.getString('description', true),
            color,
            emoji: interaction.options.getString('emoji'),
            imageUrl,
            thumbnailUrl,
            footer: interaction.options.getString('footer'),
            buttonLabel,
            buttonUrl
        });

        const embed = new EmbedBuilder()
            .setColor('#ff66cc')
            .setTitle('Preview thông báo')
            .setDescription(`Sẽ gửi tại <#${channel.id}>${data.roleId ? ` và ping <@&${data.roleId}>` : ''}.\nBấm **Gửi thông báo** để xác nhận.`);

        return interaction.reply({
            embeds: [embed, buildAnnouncementEmbed(data)],
            components: previewButtons(data.id),
            flags: MessageFlags.Ephemeral
        });
    }
};
