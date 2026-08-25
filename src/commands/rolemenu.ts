import {
    ChannelType,
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';
import { config } from '../config';
import { assertRoleAssignable } from '../systems/rolemenu/role-assignable-gate';
import { publishMenu, unpublishMenu } from '../systems/rolemenu/rolemenu-publisher';
import {
    addOption,
    createMenu,
    deleteMenu,
    getMenu,
    listMenus,
    removeOption,
    type RoleMenuMode,
    type RoleMenuStyle
} from '../systems/rolemenu/rolemenu-store';

export default {
    data: new SlashCommandBuilder()
        .setName('rolemenu')
        .setDescription('Menu tự nhận role (thay reaction role của Carl-bot)')
        .addSubcommand(sub =>
            sub.setName('create')
                .setDescription('Tạo menu mới (chưa đăng)')
                .addStringOption(option => option.setName('title').setDescription('Tiêu đề').setRequired(true).setMaxLength(200))
                .addStringOption(option => option.setName('description').setDescription('Mô tả').setRequired(true).setMaxLength(1500))
                .addStringOption(option =>
                    option.setName('mode').setDescription('Cách chọn').addChoices(
                        { name: 'multi — chọn bao nhiêu tuỳ thích', value: 'multi' },
                        { name: 'unique — chỉ giữ một role', value: 'unique' }
                    ))
                .addStringOption(option =>
                    option.setName('style').setDescription('Kiểu hiển thị').addChoices(
                        { name: 'button — nút bấm', value: 'button' },
                        { name: 'select — menu thả xuống', value: 'select' }
                    )))
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Thêm một role vào menu')
                .addIntegerOption(option => option.setName('id').setDescription('ID menu').setRequired(true))
                .addRoleOption(option => option.setName('role').setDescription('Role').setRequired(true))
                .addStringOption(option => option.setName('label').setDescription('Nhãn hiển thị').setRequired(true).setMaxLength(80))
                .addStringOption(option => option.setName('emoji').setDescription('Emoji').setMaxLength(60))
                .addStringOption(option => option.setName('description').setDescription('Mô tả ngắn').setMaxLength(100)))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Bỏ một role khỏi menu')
                .addIntegerOption(option => option.setName('id').setDescription('ID menu').setRequired(true))
                .addRoleOption(option => option.setName('role').setDescription('Role').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('post')
                .setDescription('Đăng menu (hoặc cập nhật tin đã đăng)')
                .addIntegerOption(option => option.setName('id').setDescription('ID menu').setRequired(true))
                .addChannelOption(option =>
                    option.setName('channel').setDescription('Kênh đăng').addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(sub => sub.setName('list').setDescription('Danh sách menu'))
        .addSubcommand(sub =>
            sub.setName('delete')
                .setDescription('Xoá menu và tin đã đăng')
                .addIntegerOption(option => option.setName('id').setDescription('ID menu').setRequired(true)))
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

        if (sub === 'create') {
            const menu = await createMenu({
                channelId: interaction.channelId,
                title: interaction.options.getString('title', true),
                description: interaction.options.getString('description', true),
                mode: (interaction.options.getString('mode') as RoleMenuMode) || 'multi',
                style: (interaction.options.getString('style') as RoleMenuStyle) || 'button',
                createdBy: interaction.user.id
            });
            return interaction.editReply(
                `${emojis.success} Đã tạo menu **#${menu.id}**.\n` +
                `Thêm role: \`/rolemenu add id:${menu.id} role:@... label:...\`\n` +
                `Đăng: \`/rolemenu post id:${menu.id}\``
            );
        }

        if (sub === 'add') {
            const id = interaction.options.getInteger('id', true);
            const role = interaction.options.getRole('role', true);
            const menu = await getMenu(id);
            if (!menu) return interaction.editReply(`${emojis.error} Không tìm thấy menu #${id}.`);
            if (menu.options.length >= config.roleMenu.maxOptions) {
                return interaction.editReply(`${emojis.error} Menu đã đủ ${config.roleMenu.maxOptions} lựa chọn.`);
            }
            if (menu.options.some(option => option.roleId === role.id)) {
                return interaction.editReply(`${emojis.close} Role này đã có trong menu.`);
            }

            // Cổng an toàn: chặn role quyền cao / role bot / role cao hơn Stella.
            assertRoleAssignable(interaction.guild, role as any);

            await addOption({
                menuId: id,
                roleId: role.id,
                label: interaction.options.getString('label', true),
                emoji: interaction.options.getString('emoji'),
                description: interaction.options.getString('description')
            });
            // Menu đã đăng thì cập nhật luôn, để admin không phải nhớ chạy `post` lần nữa.
            const posted = menu.messageId ? await publishMenu(interaction.guild, id).catch(() => null) : null;
            return interaction.editReply(
                `${emojis.success} Đã thêm <@&${role.id}> vào menu #${id}.` +
                (posted ? `\nMenu đã đăng được cập nhật: ${posted}` : '')
            );
        }

        if (sub === 'remove') {
            const id = interaction.options.getInteger('id', true);
            const role = interaction.options.getRole('role', true);
            const count = await removeOption(id, role.id);
            if (!count) return interaction.editReply(`${emojis.close} Role đó không có trong menu #${id}.`);
            const menu = await getMenu(id);
            const posted = menu?.messageId && menu.options.length
                ? await publishMenu(interaction.guild, id).catch(() => null)
                : null;
            return interaction.editReply(
                `${emojis.success} Đã bỏ <@&${role.id}> khỏi menu #${id}.` +
                (posted ? `\nMenu đã đăng được cập nhật.` : '')
            );
        }

        if (sub === 'post') {
            const id = interaction.options.getInteger('id', true);
            const channel = interaction.options.getChannel('channel');
            const url = await publishMenu(interaction.guild, id, channel?.id);
            return interaction.editReply(`${emojis.success} Đã đăng menu #${id}: ${url}`);
        }

        if (sub === 'delete') {
            const id = interaction.options.getInteger('id', true);
            const menu = await getMenu(id);
            if (!menu) return interaction.editReply(`${emojis.error} Không tìm thấy menu #${id}.`);
            // Xoá tin TRƯỚC khi xoá row: bỏ lại tin nhắn thì người ta vẫn bấm được vào
            // một menu không còn tồn tại và chỉ nhận được thông báo lỗi.
            await unpublishMenu(interaction.guild, menu.channelId, menu.messageId);
            await deleteMenu(id);
            return interaction.editReply(`${emojis.success} Đã xoá menu #${id} và tin nhắn của nó.`);
        }

        const menus = await listMenus();
        if (!menus.length) return interaction.editReply(`${emojis.note} Chưa có menu nào. Tạo bằng \`/rolemenu create\`.`);
        return interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('Role menu')
                .setDescription(menus.map(menu =>
                    `**#${menu.id}** · ${menu.title}\n` +
                    `   ${menu.mode} · ${menu.style} · ${menu.options.length} role · ` +
                    (menu.messageId ? `[đã đăng](https://discord.com/channels/${interaction.guildId}/${menu.channelId}/${menu.messageId})` : '*chưa đăng*')
                ).join('\n').slice(0, 4000))]
        });
    }
};
