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

        const color = normalizeColor(interaction.options.getString('color'));
        if (interaction.options.getString('color') && !color) {
            return interaction.reply({ content: 'Màu hex không hợp lệ. VD: ff66cc hoặc #ff66cc.', flags: MessageFlags.Ephemeral });
        }

        const buttonLabel = interaction.options.getString('button_label');
        const buttonUrl = interaction.options.getString('button_url');
        if ((buttonLabel && !buttonUrl) || (!buttonLabel && buttonUrl)) {
            return interaction.reply({ content: 'Nút link cần có cả label và URL.', flags: MessageFlags.Ephemeral });
        }

        const data = createPendingAnnouncement({
            creatorId: interaction.user.id,
            channelId: channel.id,
            roleId: interaction.options.getRole('ping_role')?.id || null,
            title: interaction.options.getString('title', true),
            description: interaction.options.getString('description', true),
            color,
            emoji: interaction.options.getString('emoji'),
            imageUrl: interaction.options.getString('image'),
            thumbnailUrl: interaction.options.getString('thumbnail'),
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
