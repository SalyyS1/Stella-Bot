import {
    ChannelType,
    ChatInputCommandInteraction,
    EmbedBuilder,
    GuildMember,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
    TextChannel
} from 'discord.js';
import { config } from '../config';
import { closeTicket, isTicketStaff, publishPanel } from '../systems/ticket/ticket-service';
import { getTicketByChannel, getTicketConfig, listOpenTickets, saveTicketConfig } from '../systems/ticket/ticket-store';

export default {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Kênh liên hệ riêng với ban quản trị (thay Ticket Tool / modmail Carl-bot)')
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Dựng panel mở ticket')
                .addChannelOption(option =>
                    option.setName('channel').setDescription('Kênh đặt panel').addChannelTypes(ChannelType.GuildText))
                .addChannelOption(option =>
                    option.setName('category').setDescription('Category chứa kênh ticket').addChannelTypes(ChannelType.GuildCategory))
                .addRoleOption(option => option.setName('staffrole').setDescription('Role ban quản trị'))
                .addIntegerOption(option =>
                    option.setName('maxperuser').setDescription('Số ticket mở cùng lúc mỗi người').setMinValue(1).setMaxValue(5)))
        .addSubcommand(sub =>
            sub.setName('close')
                .setDescription('Đóng ticket trong kênh này')
                .addStringOption(option => option.setName('reason').setDescription('Lý do đóng').setMaxLength(500)))
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Thêm người vào ticket này (chỉ ban quản trị)')
                .addUserOption(option => option.setName('user').setDescription('Thành viên').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Bỏ người khỏi ticket này (chỉ ban quản trị)')
                .addUserOption(option => option.setName('user').setDescription('Thành viên').setRequired(true)))
        .addSubcommand(sub => sub.setName('list').setDescription('Ticket đang mở'))
        .addSubcommand(sub => sub.setName('status').setDescription('Xem cấu hình ticket')),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        const sub = interaction.options.getSubcommand();
        const member = interaction.member as GuildMember | null;
        if (!interaction.guild || !member) {
            return interaction.reply({ content: `${emojis.error} Lệnh này chỉ dùng trong server.`, flags: MessageFlags.Ephemeral });
        }

        if (sub === 'setup') {
            if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                return interaction.reply({ content: `${emojis.error} Bạn cần quyền Manage Server.`, flags: MessageFlags.Ephemeral });
            }
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            if (!interaction.guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
                return interaction.editReply(
                    `${emojis.error} Stella thiếu quyền **Manage Channels** nên sẽ không tạo được kênh ticket. ` +
                    'Cấp quyền rồi chạy lại.'
                );
            }

            const channelId = interaction.options.getChannel('channel')?.id || interaction.channelId;
            const category = interaction.options.getChannel('category');
            const staffRole = interaction.options.getRole('staffrole');
            const existing = await getTicketConfig(interaction.guild.id);

            await saveTicketConfig(interaction.guild.id, {
                categoryId: category?.id ?? existing?.categoryId ?? null,
                staffRoleId: staffRole?.id ?? existing?.staffRoleId ?? null,
                panelChannelId: channelId,
                maxPerUser: interaction.options.getInteger('maxperuser') ?? existing?.maxPerUser ?? 2
            });

            const url = await publishPanel(interaction.guild, channelId);
            // Lưu messageId sau khi đăng để lần setup sau SỬA panel cũ thay vì đăng cái thứ hai.
            const messageId = url.split('/').pop();
            await saveTicketConfig(interaction.guild.id, { panelMessageId: messageId || null });

            const settings = await getTicketConfig(interaction.guild.id);
            return interaction.editReply(
                `${emojis.success} Panel ticket: ${url}\n` +
                `Category: ${settings?.categoryId ? `<#${settings.categoryId}>` : '*không (kênh sẽ nằm ngoài category)*'}\n` +
                `Role staff: ${settings?.staffRoleId ? `<@&${settings.staffRoleId}>` : '*chưa đặt — chỉ người có Manage Server thấy ticket*'}\n` +
                `Trần mỗi người: **${settings?.maxPerUser}** ticket.`
            );
        }

        if (sub === 'list') {
            if (!await isTicketStaff(member)) {
                return interaction.reply({ content: `${emojis.error} Chỉ ban quản trị xem được.`, flags: MessageFlags.Ephemeral });
            }
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const open = await listOpenTickets();
            return interaction.editReply(
                open.length
                    ? `${emojis.note} **${open.length}** ticket đang mở:\n` +
                      open.map(ticket =>
                          `• #${ticket.id} <#${ticket.channelId}> · <@${ticket.openerId}>` +
                          (ticket.claimedBy ? ` · đang xử: <@${ticket.claimedBy}>` : ' · *chưa ai nhận*')
                      ).join('\n').slice(0, 1800)
                    : `${emojis.note} Không có ticket nào đang mở.`
            );
        }

        if (sub === 'status') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const settings = await getTicketConfig(interaction.guild.id);
            if (!settings) return interaction.editReply(`${emojis.note} Ticket chưa được cấu hình. Dùng \`/ticket setup\`.`);
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#5865F2')
                    .setTitle('Cấu hình ticket')
                    .setDescription(
                        `Panel: ${settings.panelChannelId ? `<#${settings.panelChannelId}>` : '*chưa đăng*'}\n` +
                        `Category: ${settings.categoryId ? `<#${settings.categoryId}>` : '*không*'}\n` +
                        `Role staff: ${settings.staffRoleId ? `<@&${settings.staffRoleId}>` : '*chưa đặt*'}\n` +
                        `Trần mỗi người: ${settings.maxPerUser}`
                    )]
            });
        }

        // Ba lệnh còn lại chỉ chạy trong kênh ticket.
        const ticket = await getTicketByChannel(interaction.channelId);
        if (!ticket || ticket.closedAt) {
            return interaction.reply({ content: `${emojis.error} Lệnh này chỉ dùng trong kênh ticket đang mở.`, flags: MessageFlags.Ephemeral });
        }

        if (sub === 'close') {
            const allowed = ticket.openerId === interaction.user.id || await isTicketStaff(member);
            if (!allowed) {
                return interaction.reply({ content: `${emojis.error} Chỉ người mở hoặc ban quản trị đóng được.`, flags: MessageFlags.Ephemeral });
            }
            await interaction.reply({ content: `${emojis.note} Đang lưu transcript...`, flags: MessageFlags.Ephemeral });
            const result = await closeTicket(interaction.channel as TextChannel, interaction.user.id, interaction.options.getString('reason'));
            if (!result.ok) return interaction.editReply(`${emojis.error} ${result.error}`);
            return;
        }

        // add/remove: CHỈ staff. Người mở tự thêm người khác vào ticket của mình là đường
        // lộ dữ liệu của chính họ cho người họ không định cho xem — và họ không lường được
        // hậu quả vì nút trông vô hại.
        if (!await isTicketStaff(member)) {
            return interaction.reply({ content: `${emojis.error} Chỉ ban quản trị thêm/bỏ người được.`, flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const target = interaction.options.getUser('user', true);
        const channel = interaction.channel as TextChannel;

        if (sub === 'add') {
            const ok = await channel.permissionOverwrites.edit(target.id, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
            }).then(() => true).catch(() => false);
            return interaction.editReply(ok ? `${emojis.success} Đã thêm ${target} vào ticket.` : `${emojis.error} Không sửa được quyền kênh.`);
        }

        if (target.id === ticket.openerId) {
            return interaction.editReply(`${emojis.error} Không bỏ được người mở ticket. Đóng ticket nếu cần.`);
        }
        const ok = await channel.permissionOverwrites.delete(target.id).then(() => true).catch(() => false);
        return interaction.editReply(ok ? `${emojis.success} Đã bỏ ${target} khỏi ticket.` : `${emojis.error} Không sửa được quyền kênh.`);
    }
};
