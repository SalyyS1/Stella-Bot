import {
    ChatInputCommandInteraction,
    Collection,
    Message,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
    TextChannel
} from 'discord.js';
import { config } from '../config';
import { createModCase } from '../systems/moderation/mod-case-manager';

// Trần một lượt gọi. Bulk delete của Discord chỉ nhận 100 tin và chỉ tin dưới 14
// ngày — xin nhiều hơn thì API từ chối cả lô, nên chặn ở đây để mod nhận lời giải
// thích thay vì một lỗi API.
const MAX_PURGE = 100;
// Trên mức này phải xác nhận: xoá 80 tin do gõ nhầm số là thứ không lấy lại được.
const CONFIRM_THRESHOLD = 50;

export default {
    data: new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Xoá nhiều tin nhắn trong kênh này (có lưu transcript vào log)')
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Số tin cần xoá (1-100)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(MAX_PURGE))
        .addUserOption(option => option.setName('user').setDescription('Chỉ xoá tin của người này').setRequired(false))
        .addStringOption(option => option.setName('contains').setDescription('Chỉ xoá tin có chứa chữ này').setRequired(false).setMaxLength(200))
        .addBooleanOption(option => option.setName('confirm').setDescription(`Bắt buộc khi xoá hơn ${CONFIRM_THRESHOLD} tin`).setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
            return interaction.reply({ content: `${emojis.error} Bạn cần quyền Manage Messages.`, flags: MessageFlags.Ephemeral });
        }

        const amount = interaction.options.getInteger('amount', true);
        const targetUser = interaction.options.getUser('user');
        const contains = interaction.options.getString('contains')?.toLowerCase();
        const confirmed = interaction.options.getBoolean('confirm') ?? false;

        if (amount > CONFIRM_THRESHOLD && !confirmed) {
            return interaction.reply({
                content: `${emojis.appeal} Bạn đang xoá **${amount}** tin — việc này không lấy lại được. ` +
                    'Chạy lại lệnh với `confirm: True` nếu đúng ý bạn.',
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const channel = interaction.channel as TextChannel;
            if (!channel?.isTextBased() || !('bulkDelete' in channel)) {
                return interaction.editReply(`${emojis.error} Kênh này không xoá hàng loạt được.`);
            }

            // Lấy nhiều hơn số cần khi có bộ lọc, vì phần lớn tin sẽ bị lọc ra.
            const fetchLimit = targetUser || contains ? MAX_PURGE : amount;
            const fetched = await channel.messages.fetch({ limit: fetchLimit });

            const cutoff = Date.now() - 14 * 86_400_000;
            const selected = fetched.filter(message => {
                if (message.id === interaction.id) return false;
                if (message.createdTimestamp < cutoff) return false;
                if (message.pinned) return false; // tin đã ghim là tin có chủ đích, không dọn cùng
                if (targetUser && message.author.id !== targetUser.id) return false;
                if (contains && !message.content.toLowerCase().includes(contains)) return false;
                return true;
            });

            const toDelete = new Collection<string, Message>();
            for (const [id, message] of selected) {
                if (toDelete.size >= amount) break;
                toDelete.set(id, message as Message);
            }

            if (!toDelete.size) {
                return interaction.editReply(
                    `${emojis.note} Không có tin nào khớp. Lưu ý Discord không cho xoá hàng loạt tin cũ hơn 14 ngày, ` +
                    'và tin đã ghim được giữ lại có chủ đích.'
                );
            }

            const deleted = await channel.bulkDelete(toDelete, true);

            // Transcript đi kèm log bulk-delete (xem events/messageDeleteBulk.ts) nên
            // ở đây chỉ cần ghi hồ sơ ai đã purge — bản ghi nội dung đã có chỗ khác.
            await createModCase({
                targetId: interaction.user.id,
                actorId: interaction.user.id,
                kind: 'NOTE',
                reason: `Purge ${deleted.size} tin ở #${channel.name}` +
                    (targetUser ? ` · chỉ của ${targetUser.tag}` : '') +
                    (contains ? ` · chứa "${contains}"` : ''),
                evidence: channel.id
            }).catch(() => {});

            return interaction.editReply(
                `${emojis.success} Đã xoá **${deleted.size}** tin.` +
                (deleted.size < toDelete.size ? `\n${emojis.appeal} ${toDelete.size - deleted.size} tin bị Discord từ chối (quá 14 ngày).` : '') +
                '\nNội dung đã được lưu vào log kèm file transcript.'
            );
        } catch (error: any) {
            console.error('[purge] lỗi:', error);
            return interaction.editReply(`${emojis.error} ${error?.message || 'Không xoá được tin nhắn.'}`);
        }
    }
};
