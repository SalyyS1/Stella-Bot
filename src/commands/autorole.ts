import { ChatInputCommandInteraction, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { config } from '../config';
import { addAutoRole, listAutoRoles, removeAutoRole } from '../systems/roles/autorole-manager';

export default {
    data: new SlashCommandBuilder()
        .setName('autorole')
        .setDescription('Role cấp tự động cho người mới vào server (thay autorole Dyno/Carl-bot)')
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Thêm role cấp tự động')
                .addRoleOption(option => option.setName('role').setDescription('Role').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Bỏ một role khỏi danh sách')
                .addRoleOption(option => option.setName('role').setDescription('Role').setRequired(true)))
        .addSubcommand(sub => sub.setName('list').setDescription('Xem danh sách autorole'))
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
            const rows = await listAutoRoles();
            return interaction.editReply(
                rows.length
                    ? `${emojis.note} Người mới sẽ tự nhận: ${rows.map(row => `<@&${row.roleId}>`).join(', ')}`
                    : `${emojis.note} Chưa có autorole nào.`
            );
        }

        const role = interaction.options.getRole('role', true);

        if (sub === 'add') {
            try {
                // Cổng an toàn dùng chung với role menu: chặn role quyền cao, role bot,
                // role cao hơn Stella. Autorole là đường phát role rộng nhất của bot nên
                // sai ở đây là mọi acc mới đều thành mod.
                await addAutoRole(interaction.guild, role as any, interaction.user.id);
            } catch (error: any) {
                return interaction.editReply(`${emojis.error} ${error.message}`);
            }
            return interaction.editReply(`${emojis.success} Người mới vào server sẽ tự nhận <@&${role.id}>.`);
        }

        const removed = await removeAutoRole(role.id);
        return interaction.editReply(
            removed ? `${emojis.success} Đã bỏ <@&${role.id}> khỏi autorole.` : `${emojis.close} Role đó không có trong danh sách.`
        );
    }
};
