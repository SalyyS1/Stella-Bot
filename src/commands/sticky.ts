import { ChatInputCommandInteraction, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { config } from '../config';
import { invalidateStickyCache, listSticky, removeSticky, setSticky } from '../systems/utility/sticky-manager';

export default {
    data: new SlashCommandBuilder()
        .setName('sticky')
        .setDescription('Tin nhắn ghim mềm — tự đăng lại xuống cuối kênh (thay sticky Carl-bot)')
        .addSubcommand(sub =>
            sub.setName('set')
                .setDescription('Đặt sticky cho kênh này')
                .addStringOption(option => option.setName('content').setDescription('Nội dung').setRequired(true).setMaxLength(1800))
                .addIntegerOption(option =>
                    option.setName('gap').setDescription('Số tin trước khi đăng lại').setMinValue(1).setMaxValue(100)))
        .addSubcommand(sub => sub.setName('remove').setDescription('Bỏ sticky của kênh này'))
        .addSubcommand(sub => sub.setName('list').setDescription('Xem mọi sticky đang bật'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
            return interaction.reply({ content: `${emojis.error} Bạn cần quyền Manage Messages.`, flags: MessageFlags.Ephemeral });
        }

        const sub = interaction.options.getSubcommand();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (sub === 'set') {
            const gap = interaction.options.getInteger('gap') ?? config.utility.sticky.defaultMinGap;
            await setSticky({
                channelId: interaction.channelId,
                content: interaction.options.getString('content', true),
                minGap: gap,
                createdBy: interaction.user.id
            });
            invalidateStickyCache();
            return interaction.editReply(
                `${emojis.success} Đã đặt sticky cho kênh này — bot đăng lại sau mỗi **${gap}** tin. ` +
                'Bản cũ luôn bị xoá trước khi đăng bản mới nên kênh không bị nhân đôi.'
            );
        }

        if (sub === 'remove') {
            const row = await removeSticky(interaction.channelId);
            invalidateStickyCache();
            if (!row) return interaction.editReply(`${emojis.close} Kênh này không có sticky.`);
            // Dọn nốt bản đang hiển thị: bỏ lại thì kênh còn một tin nội quy mà bot
            // không còn quản lý, không ai biết xoá bằng cách nào.
            if (row.lastMessageId && interaction.channel?.isTextBased()) {
                await (interaction.channel as any).messages.fetch(row.lastMessageId)
                    .then((message: any) => message.delete())
                    .catch(() => {});
            }
            return interaction.editReply(`${emojis.success} Đã bỏ sticky của kênh này.`);
        }

        const rows = await listSticky();
        return interaction.editReply(
            rows.length
                ? `${emojis.note} Sticky đang bật:\n` +
                  rows.map(row => `• <#${row.channelId}> — mỗi ${row.minGap} tin`).join('\n').slice(0, 1800)
                : `${emojis.note} Chưa có sticky nào.`
        );
    }
};
