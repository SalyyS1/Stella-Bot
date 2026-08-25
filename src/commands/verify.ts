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
import { addOption, createMenu, deleteMenu, listMenus, removeOption } from '../systems/rolemenu/rolemenu-store';

// Cổng xác minh = một role menu ở chế độ `verify` (chỉ cấp, không gỡ). Không dựng bảng
// riêng cho nó: bài toán y hệt role menu, chỉ khác luật bấm.
//
// Bot CỐ Ý không tự sửa quyền kênh. Để chặn người chưa verify thì phải gỡ quyền xem của
// @everyone trên toàn bộ kênh — một thao tác quét cả server, khó lùi, và nếu bot làm sai
// một kênh thì cả server mất quyền xem. Việc đó để admin làm tay, bot chỉ hướng dẫn.

async function findVerifyMenu() {
    const menus = await listMenus();
    return menus.find(menu => menu.mode === 'verify') || null;
}

export default {
    data: new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Cổng xác minh cho người mới')
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Dựng (hoặc đổi) cổng xác minh')
                .addRoleOption(option => option.setName('role').setDescription('Role cấp sau khi verify').setRequired(true))
                .addChannelOption(option =>
                    option.setName('channel').setDescription('Kênh đặt nút').addChannelTypes(ChannelType.GuildText))
                .addStringOption(option => option.setName('title').setDescription('Tiêu đề').setMaxLength(200))
                .addStringOption(option => option.setName('description').setDescription('Nội dung').setMaxLength(1500)))
        .addSubcommand(sub => sub.setName('status').setDescription('Xem cổng xác minh hiện tại'))
        .addSubcommand(sub => sub.setName('off').setDescription('Gỡ cổng xác minh'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({ content: `${emojis.error} Bạn cần quyền Manage Server.`, flags: MessageFlags.Ephemeral });
        }
        if (!interaction.guild) {
            return interaction.reply({ content: `${emojis.error} Lệnh này chỉ dùng trong server.`, flags: MessageFlags.Ephemeral });
        }

        const sub = interaction.options.getSubcommand();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const existing = await findVerifyMenu();

        if (sub === 'status') {
            if (!existing) return interaction.editReply(`${emojis.note} Chưa dựng cổng xác minh. Dùng \`/verify setup\`.`);
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#2ecc71')
                    .setTitle('Cổng xác minh')
                    .setDescription(
                        `Menu **#${existing.id}** ở <#${existing.channelId}>\n` +
                        `Role cấp: ${existing.options.map(option => `<@&${option.roleId}>`).join(', ') || '*chưa có*'}\n` +
                        (existing.messageId
                            ? `[Tới nút verify](https://discord.com/channels/${interaction.guildId}/${existing.channelId}/${existing.messageId})`
                            : '*chưa đăng*')
                    )]
            });
        }

        if (sub === 'off') {
            if (!existing) return interaction.editReply(`${emojis.close} Không có cổng xác minh nào đang bật.`);
            await unpublishMenu(interaction.guild, existing.channelId, existing.messageId);
            await deleteMenu(existing.id);
            return interaction.editReply(
                `${emojis.success} Đã gỡ cổng xác minh. Nhớ trả lại quyền xem kênh cho \`@everyone\` ` +
                'nếu bạn đã khoá chúng, nếu không người mới sẽ vào một server trống.'
            );
        }

        const role = interaction.options.getRole('role', true);
        assertRoleAssignable(interaction.guild, role as any);

        const channelId = interaction.options.getChannel('channel')?.id || interaction.channelId;
        const title = interaction.options.getString('title') || `${emojis.starJump} Xác minh để vào server`;
        const description = interaction.options.getString('description')
            || `Bấm nút bên dưới để xác nhận bạn là người thật và mở khoá các kênh của <#${config.channels.chat}>.`;

        // Có cổng rồi thì ĐỔI nó, không tạo cái thứ hai: hai cổng verify song song nghĩa
        // là hai role khác nhau được cấp tuỳ người ta bấm vào tin nào.
        const menu = existing ?? await createMenu({
            channelId,
            title,
            description,
            mode: 'verify',
            style: 'button',
            createdBy: interaction.user.id
        });

        if (existing) {
            for (const option of existing.options) await removeOption(existing.id, option.roleId);
        }
        await addOption({ menuId: menu.id, roleId: role.id, label: 'Tôi là người thật', emoji: '✅' });
        await publishMenu(interaction.guild, menu.id, channelId);

        return interaction.editReply(
            `${emojis.success} Cổng xác minh đã sẵn sàng ở <#${channelId}> — bấm nút sẽ nhận <@&${role.id}>.\n\n` +
            `${emojis.appeal} **Còn một bước phải làm tay**: vào Server Settings → Roles → \`@everyone\`, ` +
            `bỏ quyền **View Channel** ở các kênh cần khoá, rồi cấp quyền đó cho <@&${role.id}>. ` +
            'Bot cố ý không tự làm bước này: sửa quyền hàng loạt trên mọi kênh mà sai một chỗ thì cả server mất quyền xem.'
        );
    }
};
