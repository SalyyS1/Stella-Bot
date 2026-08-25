import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { config } from '../config';
import {
    addHighlight,
    clearHighlights,
    listHighlights,
    MAX_KEYWORDS_PER_USER,
    removeHighlight
} from '../systems/utility/highlight-manager';

// Không đặt setDefaultMemberPermissions: đây là tính năng cá nhân cho mọi member, giống
// `/afk`. Nó chỉ ảnh hưởng tới DM của chính người đặt.
export default {
    data: new SlashCommandBuilder()
        .setName('highlight')
        .setDescription('Nhận DM khi có người nhắc từ khoá của bạn (thay highlight Carl-bot)')
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Thêm từ khoá')
                .addStringOption(option => option.setName('keyword').setDescription('Từ khoá').setRequired(true).setMaxLength(50)))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Bỏ một từ khoá')
                .addStringOption(option => option.setName('keyword').setDescription('Từ khoá').setRequired(true).setMaxLength(50)))
        .addSubcommand(sub => sub.setName('list').setDescription('Xem từ khoá của bạn'))
        .addSubcommand(sub => sub.setName('clear').setDescription('Bỏ hết từ khoá')),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        const sub = interaction.options.getSubcommand();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (sub === 'list') {
            const keywords = await listHighlights(interaction.user.id);
            return interaction.editReply(
                keywords.length
                    ? `${emojis.note} Từ khoá của bạn (${keywords.length}/${MAX_KEYWORDS_PER_USER}):\n\`${keywords.join('`, `')}\``
                    : `${emojis.note} Bạn chưa đặt từ khoá nào. Thêm bằng \`/highlight add\`.`
            );
        }

        if (sub === 'clear') {
            const removed = await clearHighlights(interaction.user.id);
            return interaction.editReply(`${emojis.success} Đã bỏ **${removed}** từ khoá.`);
        }

        const keyword = interaction.options.getString('keyword', true);

        if (sub === 'remove') {
            const removed = await removeHighlight(interaction.user.id, keyword);
            return interaction.editReply(
                removed ? `${emojis.success} Đã bỏ \`${keyword.toLowerCase()}\`.` : `${emojis.close} Bạn không có từ khoá đó.`
            );
        }

        try {
            const saved = await addHighlight(interaction.user.id, keyword);
            return interaction.editReply(
                `${emojis.success} Đã thêm \`${saved}\`. Bạn sẽ nhận DM khi có người nhắc từ này.\n` +
                '-# Bot chỉ gửi khi bạn có quyền đọc kênh đó, không gửi về tin của chính bạn, ' +
                'và tối đa một DM mỗi 5 phút cho mỗi kênh. Nhớ mở DM từ thành viên server.'
            );
        } catch (error: any) {
            return interaction.editReply(`${emojis.error} ${error.message}`);
        }
    }
};
