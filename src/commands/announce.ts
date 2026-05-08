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
        .setDescription('Tao thong bao embed cho admin')
        .addSubcommand(sub =>
            sub.setName('create')
                .setDescription('Tao preview thong bao truoc khi gui')
                .addChannelOption(option => option.setName('channel').setDescription('Kenh can gui').setRequired(true))
                .addStringOption(option => option.setName('title').setDescription('Tieu de').setRequired(true).setMaxLength(200))
                .addStringOption(option => option.setName('description').setDescription('Noi dung').setRequired(true).setMaxLength(2000))
                .addRoleOption(option => option.setName('ping_role').setDescription('Role can ping').setRequired(false))
                .addStringOption(option => option.setName('color').setDescription('Mau hex, VD ff66cc').setRequired(false))
                .addStringOption(option => option.setName('emoji').setDescription('Emoji/icon dau title').setRequired(false).setMaxLength(50))
                .addStringOption(option => option.setName('image').setDescription('Anh/banner URL').setRequired(false))
                .addStringOption(option => option.setName('thumbnail').setDescription('Thumbnail URL').setRequired(false))
                .addStringOption(option => option.setName('footer').setDescription('Footer').setRequired(false).setMaxLength(200))
                .addStringOption(option => option.setName('button_label').setDescription('Label nut link').setRequired(false).setMaxLength(80))
                .addStringOption(option => option.setName('button_url').setDescription('URL nut link').setRequired(false))),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'Ban can quyen Administrator de tao thong bao.', flags: MessageFlags.Ephemeral });
        }

        const sub = interaction.options.getSubcommand();
        if (sub !== 'create') return;

        const channel = interaction.options.getChannel('channel', true);
        if (!(channel as any).isTextBased?.()) {
            return interaction.reply({ content: 'Kenh gui thong bao khong hop le.', flags: MessageFlags.Ephemeral });
        }

        const color = normalizeColor(interaction.options.getString('color'));
        if (interaction.options.getString('color') && !color) {
            return interaction.reply({ content: 'Mau hex khong hop le. VD: ff66cc hoac #ff66cc.', flags: MessageFlags.Ephemeral });
        }

        const buttonLabel = interaction.options.getString('button_label');
        const buttonUrl = interaction.options.getString('button_url');
        if ((buttonLabel && !buttonUrl) || (!buttonLabel && buttonUrl)) {
            return interaction.reply({ content: 'Nut link can co ca label va URL.', flags: MessageFlags.Ephemeral });
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
            .setTitle('Preview thong bao')
            .setDescription(`Se gui tai <#${channel.id}>${data.roleId ? ` va ping <@&${data.roleId}>` : ''}.\nBam **Gui thong bao** de xac nhan.`);

        return interaction.reply({
            embeds: [embed, buildAnnouncementEmbed(data)],
            components: previewButtons(data.id),
            flags: MessageFlags.Ephemeral
        });
    }
};
