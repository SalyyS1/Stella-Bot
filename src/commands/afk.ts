import { ChatInputCommandInteraction, GuildMember, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { config } from '../config';
import { sanitizeReason, setAfk } from '../systems/utility/afk-manager';

export default {
    data: new SlashCommandBuilder()
        .setName('afk')
        .setDescription('Báo bạn đang bận — ai ping bạn sẽ được bot nhắc')
        .addStringOption(option =>
            option.setName('reason').setDescription('Lý do').setMaxLength(config.utility.afk.maxReasonLength)),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        const member = interaction.member;
        if (!(member instanceof GuildMember)) {
            return interaction.reply({ content: `${emojis.error} Lệnh này chỉ dùng trong server.`, flags: MessageFlags.Ephemeral });
        }

        const reason = sanitizeReason(interaction.options.getString('reason') || '');
        await setAfk(member, reason);

        return interaction.reply({
            content: `${emojis.note} Đã bật AFK: **${reason}**\nChat lại một câu bất kỳ là tự tắt.`,
            flags: MessageFlags.Ephemeral
        });
    }
};
