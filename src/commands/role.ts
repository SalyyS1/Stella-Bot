import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';
import { config } from '../config';
import { formatDuration, parseDurationMs } from '../utils/parse-duration';
import { grantTempRole, listTempRoles, revokeTempRole, TEMP_ROLE_MAX_MS } from '../systems/roles/temp-role-manager';

export default {
    data: new SlashCommandBuilder()
        .setName('role')
        .setDescription('Cấp role có hạn cho thành viên (thay role tạm của Dyno)')
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Cấp role có hạn')
                .addUserOption(option => option.setName('user').setDescription('Thành viên').setRequired(true))
                .addRoleOption(option => option.setName('role').setDescription('Role').setRequired(true))
                .addStringOption(option => option.setName('duration').setDescription('Thời hạn: 30m, 12h, 7d').setRequired(true))
                .addStringOption(option => option.setName('reason').setDescription('Lý do').setMaxLength(300)))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Gỡ role tạm ngay')
                .addUserOption(option => option.setName('user').setDescription('Thành viên').setRequired(true))
                .addRoleOption(option => option.setName('role').setDescription('Role').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('Xem role tạm đang chạy')
                .addUserOption(option => option.setName('user').setDescription('Chỉ của một người')))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
            return interaction.reply({ content: `${emojis.error} Bạn cần quyền Manage Roles.`, flags: MessageFlags.Ephemeral });
        }
        if (!interaction.guild) {
            return interaction.reply({ content: `${emojis.error} Lệnh này chỉ dùng trong server.`, flags: MessageFlags.Ephemeral });
        }

        const sub = interaction.options.getSubcommand();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (sub === 'list') {
            const target = interaction.options.getUser('user');
            const rows = await listTempRoles(target?.id);
            if (!rows.length) return interaction.editReply(`${emojis.note} Không có role tạm nào đang chạy.`);
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle(`Role tạm đang chạy (${rows.length})`)
                    .setDescription(rows.map(row =>
                        `<@${row.userId}> · <@&${row.roleId}> · hết hạn <t:${Math.floor(row.expiresAt.getTime() / 1000)}:R>` +
                        (row.reason ? `\n   ${row.reason}` : '')
                    ).join('\n').slice(0, 4000))]
            });
        }

        const target = interaction.options.getUser('user', true);
        const role = interaction.options.getRole('role', true);

        if (sub === 'remove') {
            const removed = await revokeTempRole(interaction.guild, target.id, role.id);
            return interaction.editReply(
                removed
                    ? `${emojis.success} Đã gỡ <@&${role.id}> của ${target}.`
                    : `${emojis.close} ${target} không có role tạm này.`
            );
        }

        let durationMs: number;
        try {
            durationMs = parseDurationMs(interaction.options.getString('duration', true), {
                maxMs: TEMP_ROLE_MAX_MS,
                minMs: 60_000,
                maxLabel: `${config.moderation.tempRoleMaxDays} ngày`
            });
        } catch (error: any) {
            return interaction.editReply(`${emojis.error} ${error.message}`);
        }

        try {
            const row = await grantTempRole({
                guild: interaction.guild,
                userId: target.id,
                role: role as any,
                durationMs,
                grantedBy: interaction.user.id,
                reason: interaction.options.getString('reason')
            });
            return interaction.editReply(
                `${emojis.success} ${target} nhận <@&${role.id}> trong **${formatDuration(durationMs)}** ` +
                `(tới <t:${Math.floor(row.expiresAt.getTime() / 1000)}:f>).\n` +
                'Bot tự gỡ khi hết hạn, kể cả khi bot có restart giữa lúc chờ.'
            );
        } catch (error: any) {
            return interaction.editReply(`${emojis.error} ${error?.message || 'Không cấp được role.'}`);
        }
    }
};
