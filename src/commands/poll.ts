import { ChannelType, ChatInputCommandInteraction, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, TextChannel } from 'discord.js';
import { config } from '../config';

// `/poll` dùng POLL GỐC của Discord, không tự dựng bằng nút.
//
// Tự dựng thì phải tự làm bốn thứ Discord đã làm sẵn và làm đúng hơn: lưu phiếu từng
// người, chặn bỏ phiếu hai lần (race khi bấm dồn), ẩn kết quả tới lúc đóng (hiện ngay thì
// phiếu sau bị phiếu trước dẫn dắt), và hẹn giờ đóng sống qua restart.
//
// Đổi lại hai giới hạn của Discord: tối đa 10 đáp án, thời hạn tính theo giờ (1–768).
// Cả hai đều chấp nhận được cho một cái poll cộng đồng.

const MAX_ANSWERS = 10;
const MAX_ANSWER_LENGTH = 55;
const MAX_DURATION_HOURS = 768;

export default {
    data: new SlashCommandBuilder()
        .setName('poll')
        .setDescription('Tạo bình chọn (dùng poll gốc của Discord)')
        .addStringOption(option =>
            option.setName('question').setDescription('Câu hỏi').setRequired(true).setMaxLength(300))
        .addStringOption(option =>
            option.setName('options')
                .setDescription('Các đáp án, ngăn bởi dấu | — vd: Có | Không | Chưa biết')
                .setRequired(true)
                .setMaxLength(600))
        .addIntegerOption(option =>
            option.setName('hours').setDescription('Số giờ mở (mặc định 24)').setMinValue(1).setMaxValue(MAX_DURATION_HOURS))
        .addBooleanOption(option => option.setName('multi').setDescription('Cho chọn nhiều đáp án'))
        .addChannelOption(option =>
            option.setName('channel').setDescription('Kênh đăng (mặc định: kênh này)').addChannelTypes(ChannelType.GuildText))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        // Poll là thứ cả kênh đọc thấy — không nên để ai cũng tạo được.
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
            return interaction.reply({ content: `${emojis.error} Bạn cần quyền Manage Messages.`, flags: MessageFlags.Ephemeral });
        }

        const answers = interaction.options.getString('options', true)
            .split('|')
            .map(part => part.trim())
            .filter(Boolean)
            .slice(0, MAX_ANSWERS)
            .map(text => ({ text: text.slice(0, MAX_ANSWER_LENGTH) }));

        if (answers.length < 2) {
            return interaction.reply({
                content: `${emojis.error} Cần ít nhất 2 đáp án, ngăn bởi dấu \`|\`. Ví dụ: \`Có | Không\``,
                flags: MessageFlags.Ephemeral
            });
        }

        const target = (interaction.options.getChannel('channel') || interaction.channel) as TextChannel | null;
        if (!target?.isTextBased()) {
            return interaction.reply({ content: `${emojis.error} Không gửi được vào kênh đó.`, flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const hours = interaction.options.getInteger('hours') ?? 24;

        const sent = await target.send({
            poll: {
                question: { text: interaction.options.getString('question', true).slice(0, 300) },
                answers,
                duration: hours,
                allowMultiselect: interaction.options.getBoolean('multi') ?? false
            },
            // Câu hỏi do người dùng nhập; poll gốc không mang mention nhưng chặn ở đây là
            // chốt an toàn nếu sau này ai thêm `content` vào payload.
            allowedMentions: { parse: [] }
        }).catch(error => {
            console.error('[poll] gửi lỗi:', error);
            return null;
        });

        if (!sent) return interaction.editReply(`${emojis.error} Không gửi được — Stella thiếu quyền ở <#${target.id}>?`);
        return interaction.editReply(
            `${emojis.success} Đã tạo bình chọn ${answers.length} đáp án, đóng sau **${hours} giờ**: ${sent.url}\n` +
            '-# Discord tự đếm phiếu, tự chặn bỏ phiếu hai lần và tự ẩn kết quả tới lúc đóng.'
        );
    }
};
