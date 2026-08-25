import { ChatInputCommandInteraction, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { config } from '../config';
import { countActiveWarns, createModCase, notifyWarnTarget } from '../systems/moderation/mod-case-manager';

export default {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Cảnh cáo một thành viên và ghi vào hồ sơ kiểm duyệt')
        .addUserOption(option => option.setName('user').setDescription('Thành viên bị cảnh cáo').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Lý do').setRequired(true).setMaxLength(500))
        .addStringOption(option => option.setName('evidence').setDescription('Link tin nhắn làm bằng chứng').setRequired(false).setMaxLength(300))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ content: `${emojis.error} Bạn cần quyền Moderate Members để cảnh cáo.`, flags: MessageFlags.Ephemeral });
        }

        const target = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason', true);
        const evidence = interaction.options.getString('evidence');

        if (target.bot) {
            return interaction.reply({ content: `${emojis.error} Không cảnh cáo bot.`, flags: MessageFlags.Ephemeral });
        }
        if (target.id === interaction.user.id) {
            return interaction.reply({ content: `${emojis.error} Không tự cảnh cáo chính mình.`, flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const record = await createModCase({
                targetId: target.id,
                actorId: interaction.user.id,
                kind: 'WARN',
                reason,
                evidence,
                notifyClient: interaction.client
            });

            // DM sau khi đã ghi hồ sơ: người chặn DM không được nhờ đó mà thoát hồ sơ.
            const dmSent = await notifyWarnTarget(interaction.client, target.id, reason, record.id);
            const warns = await countActiveWarns(target.id);

            // Không tự timeout theo số warn (Saly chốt): bot chỉ ghi nhận, quyết định
            // xử tiếp là của mod.
            return interaction.editReply(
                `${emojis.success} Đã ghi cảnh cáo **#${record.id}** cho ${target}.\n` +
                `Số warn còn hiệu lực: **${warns.warns}** · tổng hồ sơ: **${warns.total}**.\n` +
                (dmSent ? 'Đã gửi DM thông báo.' : `${emojis.appeal} Không gửi được DM (người này chặn DM).`)
            );
        } catch (error: any) {
            console.error('[warn] lỗi:', error);
            return interaction.editReply(`${emojis.error} ${error?.message || 'Không ghi được cảnh cáo.'}`);
        }
    }
};
