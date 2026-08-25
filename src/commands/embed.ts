import {
    ChannelType,
    ChatInputCommandInteraction,
    EmbedBuilder,
    GuildTextBasedChannel,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';
import { config } from '../config';

// `/embed` — gửi một embed dưới danh nghĩa bot.
//
// Rủi ro duy nhất nhưng lớn: embed do bot gửi mang quyền ping của bot. Không chặn mention
// thì `/embed` là công cụ ping `@everyone` trông rất chính thức, dùng được bởi bất kỳ ai
// có Manage Messages. Nên `allowedMentions: { parse: [] }` là điều kiện để lệnh này tồn tại.

const HEX_PATTERN = /^#?[0-9a-f]{6}$/i;

export default {
    data: new SlashCommandBuilder()
        .setName('embed')
        .setDescription('Gửi một embed do bot đăng (thay embed builder Carl-bot/Dyno)')
        .addStringOption(option => option.setName('title').setDescription('Tiêu đề').setRequired(true).setMaxLength(256))
        .addStringOption(option => option.setName('description').setDescription('Nội dung — dùng \\n để xuống dòng').setRequired(true).setMaxLength(4000))
        .addStringOption(option => option.setName('color').setDescription('Màu dạng #rrggbb').setMaxLength(7))
        .addStringOption(option => option.setName('image').setDescription('URL ảnh (https)').setMaxLength(500))
        .addStringOption(option => option.setName('footer').setDescription('Chân embed').setMaxLength(200))
        .addChannelOption(option =>
            option.setName('channel').setDescription('Kênh gửi (mặc định: kênh này)').addChannelTypes(ChannelType.GuildText))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
            return interaction.reply({ content: `${emojis.error} Bạn cần quyền Manage Messages.`, flags: MessageFlags.Ephemeral });
        }

        const rawColor = interaction.options.getString('color');
        const image = interaction.options.getString('image');
        const target = (interaction.options.getChannel('channel') || interaction.channel) as GuildTextBasedChannel | null;
        if (!target?.isTextBased()) {
            return interaction.reply({ content: `${emojis.error} Không gửi được vào kênh đó.`, flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const embed = new EmbedBuilder()
            .setTitle(interaction.options.getString('title', true))
            // `\n` gõ trong ô slash command là hai ký tự, không phải dấu xuống dòng thật.
            .setDescription(interaction.options.getString('description', true).replace(/\\n/g, '\n'))
            // Màu sai định dạng thì rơi về màu mặc định, không phải lỗi: người ta gõ
            // "đỏ" hay "red" là chuyện thường và không đáng để mất cả embed vừa soạn.
            .setColor((rawColor && HEX_PATTERN.test(rawColor) ? rawColor.replace(/^#?/, '#') : '#5865F2') as any);

        const footer = interaction.options.getString('footer');
        if (footer) embed.setFooter({ text: footer });
        // Chỉ nhận https: http để lộ nội dung server qua đường không mã hoá, và Discord
        // cũng không hiện ảnh http.
        if (image && /^https:\/\//i.test(image)) embed.setImage(image);

        const sent = await target
            .send({ embeds: [embed], allowedMentions: { parse: [] } })
            .catch(() => null);
        if (!sent) return interaction.editReply(`${emojis.error} Không gửi được — Stella thiếu quyền ở <#${target.id}>.`);

        return interaction.editReply(
            `${emojis.success} Đã gửi: ${sent.url}` +
            (image && !/^https:\/\//i.test(image) ? `\n${emojis.appeal} Ảnh bị bỏ qua: chỉ nhận link https.` : '') +
            (rawColor && !HEX_PATTERN.test(rawColor) ? `\n${emojis.appeal} Màu \`${rawColor}\` không đúng dạng \`#rrggbb\`, đã dùng màu mặc định.` : '')
        );
    }
};
