import { ChatInputCommandInteraction, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { config } from '../config';
import { buildModDigest } from '../systems/moderation/mod-digest';

export default {
    data: new SlashCommandBuilder()
        .setName('modreport')
        .setDescription('Bản tin kiểm duyệt: số liệu tin bị xoá, hồ sơ, automod, người mới')
        .addIntegerOption(option =>
            option.setName('days').setDescription('Số ngày (mặc định 7)').setMinValue(1).setMaxValue(90))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ content: `${emojis.error} Bạn cần quyền Moderate Members.`, flags: MessageFlags.Ephemeral });
        }

        // Ephemeral: bản tin có tên người bị xoá tin nhiều nhất — không phải thứ để đăng
        // giữa kênh cho cả server đọc.
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const days = interaction.options.getInteger('days') ?? 7;
        const embed = await buildModDigest(days);
        return interaction.editReply({ embeds: [embed] });
    }
};
