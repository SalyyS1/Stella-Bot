import { SlashCommandBuilder, ChatInputCommandInteraction, ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } from 'discord.js';
import { config } from '../config';

export default {
    data: new SlashCommandBuilder()
        .setName('skills')
        .setDescription('Chọn lĩnh vực kỹ năng của bạn để nhận ping khi có yêu cầu phù hợp'),

    async execute(interaction: ChatInputCommandInteraction) {
        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('skillrole_toggle')
                .setPlaceholder('Chọn/bỏ các nhóm kỹ năng của bạn...')
                .setMinValues(1)
                .setMaxValues(config.skills.length)
                .addOptions(config.skills.map(s => ({ label: s.label, value: s.key })))
        );

        await interaction.reply({
            content: `${config.ui.emojis.service} Chọn nhóm kỹ năng để Stella ping bạn khi có yêu cầu mới phù hợp. Chọn lại để bật/tắt.`,
            components: [row],
            flags: MessageFlags.Ephemeral
        });
    }
};
