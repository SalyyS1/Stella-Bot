import { ChatInputCommandInteraction, EmbedBuilder, GuildMember, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, TextChannel } from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';
import { isTicketStaff } from '../systems/ticket/ticket-service';
import { setRequestDeadline } from '../systems/request/request-deadline';

// /request add|remove: sửa quyền xem của một kênh đơn.
//
// CHỈ ban quản trị. Khách tự thêm người khác vào kênh đơn của mình là tự làm lộ yêu cầu và
// giá của chính họ cho người họ không lường được hậu quả — cùng chốt đã áp cho /ticket.
//
// Không cần xin phép anti-raid: guardChannelUpdate chỉ soi tên và topic, đổi permission
// overwrite không kích hoạt nó.
async function manageOrderChannelAccess(interaction: ChatInputCommandInteraction, sub: 'add' | 'remove') {
    const emojis = config.ui.emojis;
    const member = interaction.member as GuildMember | null;
    if (!interaction.guild || !member || !interaction.channel) {
        return interaction.reply({ content: `${emojis.error} Lệnh này chỉ dùng trong server.`, flags: MessageFlags.Ephemeral });
    }

    const request = await prisma.requestPost.findUnique({ where: { ticketChannelId: interaction.channelId } });
    if (!request) {
        return interaction.reply({ content: `${emojis.error} Kênh này không phải kênh đơn.`, flags: MessageFlags.Ephemeral });
    }
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
            ReadMessageHistory: true,
            AttachFiles: true
        }).then(() => true).catch(() => false);
        return interaction.editReply(ok
            ? `${emojis.success} Đã thêm ${target} vào kênh đơn #${request.id}.`
            : `${emojis.error} Không sửa được quyền kênh.`);
    }

    // Hai bên của đơn không bỏ được: bỏ họ ra là còn lại một kênh đơn mà người trong đơn
    // không đọc được. Muốn dừng thì đóng đơn.
    if (target.id === request.requesterId || target.id === request.claimedById) {
        return interaction.editReply(`${emojis.error} Không bỏ được khách hoặc người nhận đơn. Đóng đơn nếu cần.`);
    }
    const ok = await channel.permissionOverwrites.delete(target.id).then(() => true).catch(() => false);
    return interaction.editReply(ok
        ? `${emojis.success} Đã bỏ ${target} khỏi kênh đơn #${request.id}.`
        : `${emojis.error} Không sửa được quyền kênh.`);
}

function requestLine(request: { id: number; kind: string; status: string; service: string; requesterId: string; claimedById: string | null }) {
    const claimed = request.claimedById ? ` -> <@${request.claimedById}>` : '';
    const normalized = request.service.replace(/\s+/g, ' ').trim();
    const service = normalized.length > 160 ? `${normalized.slice(0, 159)}…` : normalized;
    return `**#${request.id}** [${request.kind}/${request.status}] ${service} - <@${request.requesterId}>${claimed}`;
}

function requestDescription(requests: Parameters<typeof requestLine>[0][]) {
    if (!requests.length) return 'Không có request phù hợp.';
    const lines: string[] = [];
    let length = 0;
    for (const request of requests) {
        const line = requestLine(request);
        if (length + line.length + 1 > 3800) break;
        lines.push(line);
        length += line.length + 1;
    }
    const omitted = requests.length - lines.length;
    return `${lines.join('\n')}${omitted ? `\n… và ${omitted} request khác.` : ''}`;
}

export default {
    data: new SlashCommandBuilder()
        .setName('request')
        .setDescription('Xem và quản lý request community')
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('Xem request gần đây')
                .addStringOption(option =>
                    option.setName('status')
                        .setDescription('Trạng thái')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Open', value: 'OPEN' },
                            { name: 'Claimed', value: 'CLAIMED' },
                            { name: 'Done', value: 'DONE' },
                            { name: 'Rated', value: 'RATED' },
                            { name: 'Closed', value: 'CLOSED' }
                        )))
        .addSubcommand(sub =>
            sub.setName('mine')
                .setDescription('Xem request của bạn'))
        .addSubcommand(sub =>
            sub.setName('stats')
                .setDescription('Thống kê request'))
        .addSubcommand(sub =>
            sub.setName('deadline')
                .setDescription('Đặt hoặc xoá hạn mong muốn cho đơn (VD: 3d, 12h, none)')
                .addIntegerOption(option => option
                    .setName('id')
                    .setDescription('ID đơn')
                    .setRequired(true)
                    .setMinValue(1))
                .addStringOption(option => option
                    .setName('when')
                    .setDescription('Thời lượng từ bây giờ: 1h, 3d; dùng none để xoá')
                    .setRequired(true)
                    .setMaxLength(30)))
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Thêm người vào kênh đơn này (ban quản trị)')
                .addUserOption(option => option.setName('user').setDescription('Thành viên').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Bỏ người khỏi kênh đơn này (ban quản trị)')
                .addUserOption(option => option.setName('user').setDescription('Thành viên').setRequired(true))),

    async execute(interaction: ChatInputCommandInteraction) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'add' || sub === 'remove') {
            return manageOrderChannelAccess(interaction, sub);
        }

        if (sub === 'deadline') {
            if (!interaction.guild) {
                return interaction.reply({ content: `${config.ui.emojis.error} Lệnh này chỉ dùng trong server.`, flags: MessageFlags.Ephemeral });
            }
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const actor = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!actor) return interaction.editReply(`${config.ui.emojis.error} Không đọc được thành viên trong server.`);
            try {
                const text = await setRequestDeadline(
                    interaction.client,
                    interaction.options.getInteger('id', true),
                    actor,
                    interaction.options.getString('when', true),
                    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false
                );
                return interaction.editReply({ content: `${config.ui.emojis.success} ${text}`, allowedMentions: { parse: [] } });
            } catch (error: any) {
                return interaction.editReply({
                    content: `${config.ui.emojis.error} ${error?.message || 'Không cập nhật được hạn đơn.'}`,
                    allowedMentions: { parse: [] }
                });
            }
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (sub === 'stats') {
            const grouped = await prisma.requestPost.groupBy({
                by: ['status'],
                _count: { id: true }
            });
            const lines = grouped.map(row => `**${row.status}:** ${row._count.id}`).join('\n') || 'Chưa có dữ liệu.';
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#ff66cc')
                    .setTitle(`${config.ui.emojis.note} Request Stats`)
                    .setDescription(lines)]
            });
        }

        const where = sub === 'mine'
            ? { requesterId: interaction.user.id }
            : { status: interaction.options.getString('status') || 'OPEN' };

        const requests = await prisma.requestPost.findMany({
            where,
            orderBy: { updatedAt: 'desc' },
            take: 15
        });

        return interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor('#ff66cc')
                .setTitle(sub === 'mine' ? `${config.ui.emojis.customer} Request của bạn` : `${config.ui.emojis.note} Request Board`)
                .setDescription(requestDescription(requests))]
        });
    }
};
