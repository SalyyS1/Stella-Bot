import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { config } from '../config';
import { getServiceProfile, setOpenForWork } from '../systems/freelancer/freelancer-profile';
import { buildFreelancerEditModal, buildServiceProfileEmbed } from '../systems/freelancer/freelancer-profile-view';

// `/freelancer` — hồ sơ nhận việc: đang rảnh không, bảng giá bao nhiêu.
//
// `edit` và `status` KHÔNG có option `user`: mỗi người chỉ sửa hồ sơ của chính mình. Thêm
// một option sửa-hộ là thêm một cái nút đổi bảng giá của người khác — admin cần xử hồ sơ
// sai phạm thì dùng đường kiểm duyệt sẵn có.

export default {
    data: new SlashCommandBuilder()
        .setName('freelancer')
        .setDescription('Hồ sơ nhận việc: trạng thái và bảng giá')
        .addSubcommand(sub =>
            sub.setName('profile')
                .setDescription('Xem hồ sơ nhận việc của một người')
                .addUserOption(option =>
                    option.setName('user').setDescription('Người bạn muốn xem (mặc định là bạn)').setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('edit').setDescription('Sửa giới thiệu và bảng giá của chính bạn')
        )
        .addSubcommand(sub =>
            sub.setName('status')
                .setDescription('Bật/tắt trạng thái đang nhận việc của chính bạn')
                .addStringOption(option =>
                    option.setName('value')
                        .setDescription('Đang nhận việc hay tạm nghỉ')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Đang nhận việc', value: 'open' },
                            { name: 'Tạm không nhận việc', value: 'closed' }
                        )
                )
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        const sub = interaction.options.getSubcommand();

        if (sub === 'edit') {
            // KHÔNG defer trước showModal: Discord không nhận showModal sau khi interaction
            // đã được trả lời, và chỉ cho 3 giây kể từ lúc nhận lệnh. Một truy vấn đọc hồ sơ
            // cũ nằm trong ngân sách đó; đừng thêm việc gì nữa vào trước đây.
            const existing = await getServiceProfile(interaction.user.id);
            try {
                await interaction.showModal(buildFreelancerEditModal(existing));
            } catch (error) {
                console.error('[freelancer] showModal failed:', error);
            }
            return;
        }

        if (sub === 'status') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const open = interaction.options.getString('value', true) === 'open';
            const saved = await setOpenForWork(interaction.user.id, open);
            if (!saved) {
                await interaction.editReply(`${emojis.error} Không lưu được trạng thái, thử lại sau nha.`);
                return;
            }
            await interaction.editReply(
                open
                    ? `${emojis.success} Đã bật **đang nhận việc**. Khách xem \`/freelancer profile\` sẽ thấy.`
                    : `${emojis.close} Đã chuyển sang **tạm không nhận việc**. Nút "Nhận job" ở đơn hàng vẫn bấm được — đây chỉ là thông tin cho khách, không phải cổng chặn.`
            );
            return;
        }

        await interaction.deferReply();
        const target = interaction.options.getUser('user') || interaction.user;
        try {
            const embed = await buildServiceProfileEmbed(target, target.id === interaction.user.id);
            await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
        } catch (error) {
            console.error('[freelancer] profile failed:', error);
            await interaction.editReply(`${emojis.error} Không đọc được hồ sơ.`).catch(() => {});
        }
    }
};
