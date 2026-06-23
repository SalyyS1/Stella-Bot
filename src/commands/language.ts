import { ChatInputCommandInteraction, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { config } from '../config';
import { getGuildLocale, localeName, normalizeLocale, setGuildLocale, tr } from '../i18n';

export default {
    data: new SlashCommandBuilder()
        .setName('language')
        .setDescription('Đổi ngôn ngữ phản hồi của Stella / Change Stella response language')
        .addSubcommand(sub =>
            sub.setName('set')
                .setDescription('Chọn ngôn ngữ cho server')
                .addStringOption(option =>
                    option.setName('locale')
                        .setDescription('Ngôn ngữ')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Tiếng Việt', value: 'vi' },
                            { name: 'English', value: 'en' }
                        )))
        .addSubcommand(sub =>
            sub.setName('current')
                .setDescription('Xem ngôn ngữ hiện tại')),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.guildId) {
            return interaction.reply({ content: `${config.ui.emojis.error} Chỉ dùng lệnh này trong server.`, flags: MessageFlags.Ephemeral });
        }

        const sub = interaction.options.getSubcommand();
        const current = await getGuildLocale(interaction.guildId);

        if (sub === 'set') {
            if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: `${config.ui.emojis.error} ${tr(current, 'error.adminOnly')}`, flags: MessageFlags.Ephemeral });
            }
            const locale = normalizeLocale(interaction.options.getString('locale', true));
            await setGuildLocale(interaction.guildId, locale);
            return interaction.reply({
                content: `${config.ui.emojis.success} ${tr(locale, 'language.updated', { localeName: localeName(locale) })}`,
                flags: MessageFlags.Ephemeral
            });
        }

        return interaction.reply({
            content: `${config.ui.emojis.note} ${tr(current, 'language.current', { localeName: localeName(current) })}`,
            flags: MessageFlags.Ephemeral
        });
    }
};
