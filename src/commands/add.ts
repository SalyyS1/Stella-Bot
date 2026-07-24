import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { config } from '../config';
import { addWiki } from '../systems/wikiManager';

// /add wiki <name> <url> [aliases] — admin-gated. Adds a plugin wiki link the AI
// can fetch for Q&A. "Admin = role higher than bot" per user; we use the
// Administrator permission for consistency with every other admin command here.
export default {
    data: new SlashCommandBuilder()
        .setName('add')
        .setDescription('Thêm dữ liệu cho Stella (Admin)')
        .addSubcommand(sub =>
            sub
                .setName('wiki')
                .setDescription('Thêm link wiki plugin để AI research (Admin, role cao hơn bot)')
                .addStringOption(o => o.setName('name').setDescription('Tên plugin (vd: mmoitems)').setRequired(true))
                .addStringOption(o => o.setName('url').setDescription('Link wiki (http/https)').setRequired(true))
                .addStringOption(o => o.setName('aliases').setDescription('Tên gọi khác, cách nhau bằng dấu phẩy').setRequired(false))
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.memberPermissions?.has('Administrator')) {
            return interaction.reply({ content: `${config.ui.emojis.error} Chỉ admin mới dùng lệnh này.`, flags: MessageFlags.Ephemeral });
        }

        if (interaction.options.getSubcommand() !== 'wiki') return;

        const name = interaction.options.getString('name', true);
        const url = interaction.options.getString('url', true);
        const aliases = interaction.options.getString('aliases') || undefined;

        const ok = await addWiki(name, url, interaction.user.id, aliases);
        if (!ok) {
            return interaction.reply({ content: `${config.ui.emojis.error} URL không hợp lệ (chỉ nhận http/https).`, flags: MessageFlags.Ephemeral });
        }
        return interaction.reply({ content: `${config.ui.emojis.success} Đã lưu wiki **${name.trim().toLowerCase()}** cho AI research.`, flags: MessageFlags.Ephemeral });
    }
};
