import {
    ChatInputCommandInteraction,
    GuildMember,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';
import { config } from '../config';
import { untimeoutMember } from '../systems/moderation/mod-actions';

export default {
    data: new SlashCommandBuilder()
        .setName('untimeout')
        .setDescription('Gỡ timeout của một thành viên và ghi hồ sơ hoàn tác')
        .addUserOption(option => option
            .setName('user')
            .setDescription('Thành viên được gỡ timeout')
            .setRequired(true))
        .addStringOption(option => option
            .setName('reason')
            .setDescription('Lý do gỡ timeout')
            .setRequired(true)
            .setMaxLength(500))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({
                content: `${emojis.error} Bạn cần quyền Moderate Members.`,
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const user = interaction.options.getUser('user', true);
        const target = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!target) return interaction.editReply(`${emojis.error} Thành viên này không còn trong server.`);

        try {
            const result = await untimeoutMember(
                { guild: interaction.guild, actor: interaction.member as GuildMember },
                target,
                interaction.options.getString('reason', true)
            );
            return interaction.editReply({
                content: `${emojis.success} Đã gỡ timeout cho ${user} — hồ sơ hoàn tác **#${result.caseId}**.`,
                allowedMentions: { parse: [] }
            });
        } catch (error: any) {
            console.error('[untimeout] lỗi:', error);
            return interaction.editReply(`${emojis.error} ${error?.message || 'Không gỡ được timeout.'}`);
        }
    }
};
