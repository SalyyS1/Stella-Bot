import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { config } from '../config';
import { createModCase, deactivateModCase, listModCases, modCaseLabel } from '../systems/moderation/mod-case-manager';

export default {
    data: new SlashCommandBuilder()
        .setName('case')
        .setDescription('Hồ sơ kiểm duyệt của thành viên')
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('Xem hồ sơ của một thành viên')
                .addUserOption(option => option.setName('user').setDescription('Thành viên').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('note')
                .setDescription('Ghi chú nội bộ (KHÔNG gửi DM cho người đó)')
                .addUserOption(option => option.setName('user').setDescription('Thành viên').setRequired(true))
                .addStringOption(option => option.setName('content').setDescription('Nội dung ghi chú').setRequired(true).setMaxLength(500)))
        .addSubcommand(sub =>
            sub.setName('close')
                .setDescription('Huỷ hiệu lực một hồ sơ (không xoá dấu vết)')
                .addIntegerOption(option => option.setName('id').setDescription('ID hồ sơ').setRequired(true)))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ content: `${emojis.error} Bạn cần quyền Moderate Members.`, flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const sub = interaction.options.getSubcommand();

        try {
            if (sub === 'note') {
                const target = interaction.options.getUser('user', true);
                const content = interaction.options.getString('content', true);
                const record = await createModCase({
                    targetId: target.id,
                    actorId: interaction.user.id,
                    kind: 'NOTE',
                    reason: content,
                    notifyClient: interaction.client
                });
                return interaction.editReply(`${emojis.success} Đã ghi chú **#${record.id}** cho ${target} (người này không được thông báo).`);
            }

            if (sub === 'close') {
                const id = interaction.options.getInteger('id', true);
                const record = await deactivateModCase(id);
                return interaction.editReply(
                    `${emojis.success} Hồ sơ **#${record.id}** (${modCaseLabel(record.kind)}) đã hết hiệu lực.\n` +
                    'Dòng hồ sơ vẫn được giữ để truy vết — chỉ không còn tính vào số warn.'
                );
            }

            const target = interaction.options.getUser('user', true);
            const cases = await listModCases(target.id, 15);
            if (!cases.length) {
                return interaction.editReply(`${emojis.note} ${target} chưa có hồ sơ kiểm duyệt nào.`);
            }

            const lines = cases.map(record =>
                `**#${record.id}** · ${modCaseLabel(record.kind)}${record.active ? '' : ' *(hết hiệu lực)*'} · <t:${Math.floor(record.createdAt.getTime() / 1000)}:d>\n` +
                `> bởi <@${record.actorId}> — ${record.reason?.slice(0, 200) || '*không ghi lý do*'}` +
                (record.evidence ? `\n> bằng chứng: \`${record.evidence}\`` : '')
            ).join('\n\n');

            const embed = new EmbedBuilder()
                .setColor('#e67e22')
                .setAuthor({ name: `Hồ sơ kiểm duyệt · ${target.username}`, iconURL: target.displayAvatarURL({ size: 128 }) })
                .setDescription(lines.slice(0, 4000))
                .setFooter({ text: `Hiển thị ${cases.length} hồ sơ gần nhất` })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (error: any) {
            console.error('[case] lỗi:', error);
            return interaction.editReply(`${emojis.error} ${error?.message || 'Không xử lý được lệnh case.'}`);
        }
    }
};
