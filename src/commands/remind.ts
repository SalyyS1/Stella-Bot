import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, EmbedBuilder } from 'discord.js';
import { config } from '../config';
import { listActive, cancelOwn } from '../systems/reminder/reminder-store';
import { setAlias, removeAlias, listAliases } from '../systems/reminder/reminder-alias-store';
import { describeSaigon } from '../systems/report/report-time-window';

// /remind — xem và huỷ lời nhắc của CHÍNH bạn.
//
// Cố tình KHÔNG có nhánh "đặt": Saly muốn đường vào là câu nói thường
// (`!s ê Stella 3h chiều nhắc tôi...`), nên thêm form đặt ở đây chỉ tạo hai đường
// làm cùng một việc rồi lệch nhau khi sửa.
//
// Nhưng đường HUỶ thì buộc phải có. Lời nhắc lặp không tự hết hạn: một lịch đặt
// sai giờ sẽ ping mỗi ngày mãi mãi, và nếu chỉ đặt được bằng câu nói mà không huỷ
// được thì người dùng không có cách nào dừng nó ngoài việc đi nhờ admin xoá DB.
export default {
    data: new SlashCommandBuilder()
        .setName('remind')
        .setDescription('Xem / huỷ lời nhắc Stella đang giữ cho bạn')
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('Xem các lời nhắc bạn đã đặt'))
        .addSubcommand(sub => sub
            .setName('cancel')
            .setDescription('Huỷ một lời nhắc theo ID (xem ID bằng /remind list)')
            .addIntegerOption(opt => opt
                .setName('id')
                .setDescription('ID lời nhắc')
                .setMinValue(1)
                .setRequired(true)))
        // Ba nhánh tên gợi nhớ. CHỈ chủ server dùng được (kiểm trong execute, không
        // bằng setDefaultMemberPermissions): quyền admin của Discord là tập khác
        // hẳn — một mod có quyền quản kênh vẫn không nên đặt được tên gợi nhớ, vì
        // một tên trỏ sai người sẽ ping oan người đó mỗi ngày.
        .addSubcommand(sub => sub
            .setName('alias-add')
            .setDescription('[Chủ server] Đặt tên gợi nhớ, ví dụ "Ri" -> một người')
            .addStringOption(opt => opt
                .setName('ten')
                .setDescription('Tên gợi nhớ, ví dụ: Ri')
                .setMaxLength(40)
                .setRequired(true))
            .addUserOption(opt => opt
                .setName('nguoi')
                .setDescription('Người mà tên này chỉ tới')
                .setRequired(true)))
        .addSubcommand(sub => sub
            .setName('alias-list')
            .setDescription('[Chủ server] Xem các tên gợi nhớ đã đặt'))
        .addSubcommand(sub => sub
            .setName('alias-remove')
            .setDescription('[Chủ server] Xoá một tên gợi nhớ')
            .addStringOption(opt => opt
                .setName('ten')
                .setDescription('Tên gợi nhớ cần xoá')
                .setMaxLength(40)
                .setRequired(true))),

    async execute(interaction: ChatInputCommandInteraction) {
        // Ephemeral: danh sách lời nhắc là việc riêng của người gõ, và đổ nó ra kênh
        // chung chỉ làm rác kênh.
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const sub = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        if (sub === 'list') {
            const rows = await listActive(userId);
            if (!rows.length) {
                return interaction.editReply({
                    content:
                        `${config.ui.emojis.note} Bạn chưa có lời nhắc nào. Nhờ Stella bằng câu nói bình thường nhé, ` +
                        'kiểu `!s ê Stella 3h chiều nay nhắc tôi họp với`.'
                });
            }

            const lines = rows.map(r => {
                const who = r.targetId === userId ? 'bạn' : `<@${r.targetId}>`;
                const when = r.repeatDaily
                    ? 'mỗi ngày'
                    : describeSaigon(r.nextFireAt.getTime());
                const note = r.message.trim() ? ` — ${r.message.trim()}` : '';
                return `\`#${r.id}\` ping ${who} **${when}**${note}`;
            });

            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#5865F2')
                    .setTitle('⏰ Lời nhắc Stella đang giữ')
                    .setDescription(lines.join('\n'))
                    .setFooter({ text: 'Huỷ bằng /remind cancel id:<số>' })],
                // Danh sách có thể chứa <@id> của người khác (lời nhắc hộ). Không
                // ping ai ở đây: đây là bảng tra, không phải lời nhắc.
                allowedMentions: { parse: [] }
            });
        }

        if (sub === 'cancel') {
            const id = interaction.options.getInteger('id', true);
            // cancelOwn tự lọc theo requesterId, nên không ai huỷ được lời nhắc của
            // người khác bằng cách đoán id — mà id là số tự tăng nên "đoán" chỉ là
            // đếm từ 1.
            const ok = await cancelOwn(userId, id);
            return interaction.editReply({
                content: ok
                    ? `${config.ui.emojis.success} Đã huỷ lời nhắc \`#${id}\`. Stella quên luôn nhé 🫡`
                    : `${config.ui.emojis.error} Không tìm thấy lời nhắc \`#${id}\` của bạn (có thể đã huỷ hoặc là của người khác).`
            });
        }

        // Từ đây là nhánh alias — cổng quyền đặt MỘT chỗ, trước cả ba nhánh, để
        // không có đường nào lọt qua nếu sau này thêm nhánh mới.
        //
        // Fail-closed khi thiếu OWNER_USER_ID: không có id chủ server thì KHÔNG ai
        // dùng được, thay vì mở cho tất cả. Cùng cách config.report.suggest đã làm.
        const ownerId = config.report.suggest.ownerUserId;
        if (!ownerId) {
            return interaction.editReply({
                content: `${config.ui.emojis.error} Tính năng này cần OWNER_USER_ID trong env mới bật được.`
            });
        }
        if (userId !== ownerId) {
            return interaction.editReply({
                content: `${config.ui.emojis.error} Tên gợi nhớ chỉ chủ server đặt được nha bồ 🙈`
            });
        }

        if (sub === 'alias-add') {
            const alias = interaction.options.getString('ten', true);
            const target = interaction.options.getUser('nguoi', true);
            const ok = await setAlias(alias, target.id, userId);
            return interaction.editReply({
                content: ok
                    ? `${config.ui.emojis.success} Xong! Từ giờ nói **${alias}** là Stella hiểu ngay <@${target.id}> 🫡\n` +
                      `Thử: \`!s 8h tối nhắc ${alias} đi tắm nha\``
                    : `${config.ui.emojis.error} Lưu tên không được, thử lại giúp nhé 😥`,
                allowedMentions: { parse: [] }
            });
        }

        if (sub === 'alias-list') {
            const rows = await listAliases();
            if (!rows.length) {
                return interaction.editReply({
                    content:
                        `${config.ui.emojis.note} Chưa có tên gợi nhớ nào. Thêm bằng ` +
                        '`/remind alias-add ten:Ri nguoi:@...`'
                });
            }
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#5865F2')
                    .setTitle('🏷️ Tên gợi nhớ')
                    .setDescription(rows.map(r => `**${r.alias}** → <@${r.userId}>`).join('\n'))
                    .setFooter({ text: 'Xoá bằng /remind alias-remove ten:<tên>' })],
                allowedMentions: { parse: [] }
            });
        }

        if (sub === 'alias-remove') {
            const alias = interaction.options.getString('ten', true);
            const ok = await removeAlias(alias);
            return interaction.editReply({
                content: ok
                    ? `${config.ui.emojis.success} Đã xoá tên **${alias}**.`
                    : `${config.ui.emojis.error} Không tìm thấy tên **${alias}**.`
            });
        }
    }
};
