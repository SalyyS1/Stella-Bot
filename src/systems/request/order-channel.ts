import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    EmbedBuilder,
    Guild,
    OverwriteResolvable,
    PermissionFlagsBits,
    TextChannel
} from 'discord.js';
import { config } from '../../config';
import { markInternalAntiRaidAction } from '../antiRaidManager';
import { sendMessageLog } from '../logs/message-log-sender';
import { buildTranscript } from '../ticket/ticket-transcript';
import { getTicketConfig } from '../ticket/ticket-store';

// Kênh riêng cho một đơn hàng: chỉ khách, người nhận, staff và bot thấy.
//
// Vì sao không gọi openTicket(): ticket gắn với TicketConfig (category riêng, trần
// maxPerUser = 2 ticket/người). Đơn hàng có quy tắc khác — trần là số đơn đang nhận, không
// phải số ticket — nên cưỡng ép dùng chung sẽ làm cả hai bên khó đọc. Thứ dùng lại được là
// buildTranscript (đã phân trang 100 tin/lượt, trần 500) và sendMessageLog.
//
// Chốt quyền giống ticket: permissionOverwrites truyền NGAY trong channels.create. Tạo kênh
// public rồi mới gỡ ViewChannel để lại vài trăm ms cả server đọc được yêu cầu và giá của
// khách.

const MEMBER_ALLOW = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks
];

function channelName(requestId: number, service: string): string {
    const slug = service.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return `don-${requestId}${slug ? `-${slug}` : ''}`.slice(0, 95);
}

async function buildOverwrites(guild: Guild, requesterId: string, claimerId: string): Promise<OverwriteResolvable[]> {
    const overwrites: OverwriteResolvable[] = [
        // @everyone mất quyền xem — đặt ngay lúc tạo, xem comment đầu file.
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: requesterId, allow: MEMBER_ALLOW },
        { id: claimerId, allow: MEMBER_ALLOW }
    ];
    if (guild.members.me) {
        overwrites.push({
            id: guild.members.me.id,
            allow: [...MEMBER_ALLOW, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages]
        });
    }
    // Dùng lại staffRole của hệ ticket thay vì tạo thêm một ô cấu hình role staff thứ hai.
    // Admin thật (quyền Administrator) bỏ qua mọi overwrite nên luôn thấy kênh này.
    const ticketSettings = await getTicketConfig(guild.id).catch(() => null);
    if (ticketSettings?.staffRoleId && guild.roles.cache.has(ticketSettings.staffRoleId)) {
        overwrites.push({ id: ticketSettings.staffRoleId, allow: MEMBER_ALLOW });
    }
    return overwrites;
}

/**
 * Nút trong kênh đơn. Chỉ có "huỷ nhận việc" — hoàn thành và đóng đơn đã có nút ở bảng đơn,
 * đặt lại ở đây là hai đường vào cùng một hành động và dễ bấm nhầm cái không định bấm.
 *
 * Quyền kiểm ở handler chứ không phải ở đây: ai thấy kênh cũng thấy nút, nhưng chỉ khách,
 * người nhận và admin bấm được (releaseRequest tự chặn).
 */
export function orderChannelButtons(requestId: number): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`request_release_${requestId}`)
            .setLabel('Huỷ nhận việc')
            .setStyle(ButtonStyle.Danger)
    );
}

export interface CreateOrderChannelOptions {
    guild: Guild;
    requestId: number;
    kind: string;
    service: string;
    description: string;
    budgetLabel: string;
    dueDate: Date | null;
    requesterId: string;
    claimerId: string;
    /** Category của kênh request — đặt kênh đơn cạnh bảng đơn của nó. */
    parentId: string | null;
}

/**
 * Tạo kênh đơn. Trả null khi không tạo được (thiếu quyền, category đã 50 kênh, API lỗi):
 * kênh riêng là tiện nghi, không phải điều kiện để nhận đơn, nên người gọi vẫn giữ đơn ở
 * trạng thái CLAIMED và chỉ ghi log.
 */
export async function createOrderChannel(options: CreateOrderChannelOptions): Promise<TextChannel | null> {
    const {
        guild, requestId, kind, service, description, budgetLabel,
        dueDate, requesterId, claimerId, parentId
    } = options;
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) return null;

    const overwrites = await buildOverwrites(guild, requesterId, claimerId);

    // Xin phép anti-raid TRƯỚC khi tạo: guardChannelCreate coi mọi kênh Stella tạo mà không
    // có phép là dấu hiệu token bị chiếm, và sẽ xoá lại kênh vừa tạo.
    markInternalAntiRaidAction('channelCreate', '*');
    const channel = await guild.channels.create({
        name: channelName(requestId, service),
        type: ChannelType.GuildText,
        parent: parentId || undefined,
        permissionOverwrites: overwrites,
        reason: `Kênh đơn #${requestId}`
    }).catch(error => {
        console.error(`[order-channel] tạo kênh cho đơn #${requestId} lỗi:`, error);
        return null;
    });
    if (!channel) return null;

    const opening = await channel.send({
        content: `<@${requesterId}> · <@${claimerId}>`,
        embeds: [new EmbedBuilder()
            .setColor(kind === 'PAID' ? config.ui.colors.requestPaid : config.ui.colors.requestFree)
            .setTitle(`${config.ui.emojis.keep} Đơn #${requestId}`)
            .setDescription(
                `**Dịch vụ:** ${service.slice(0, 500)}\n` +
                `**Phạm vi lúc nhận:**\n${description.slice(0, 1800)}\n\n` +
                `**Ngân sách lúc nhận:** ${budgetLabel}\n` +
                (dueDate ? `**Hạn mong muốn:** <t:${Math.floor(dueDate.getTime() / 1000)}:f> (<t:${Math.floor(dueDate.getTime() / 1000)}:R>)\n` : '') +
                '\n' +
                'Kênh này chỉ khách, người nhận và ban quản trị thấy. Thống nhất phạm vi, hạn và cách ' +
                'trả tiền ở đây để có gì còn tra lại được.\n\n' +
                'Thấy yêu cầu vượt quá phần đã thoả thuận theo ngân sách? Bấm **Huỷ nhận việc** — đơn ' +
                'quay về trạng thái đang mở cho người khác nhận, không mất đơn của khách.\n' +
                '-# Đơn hoàn thành hoặc bị đóng thì kênh sẽ bị xoá, nội dung lưu vào log của ban quản trị.'
            )
            .setTimestamp()],
        components: [orderChannelButtons(requestId)],
        // Ping đúng hai người trong đơn. Tên dịch vụ do khách gõ nên không cho nó ping thêm ai.
        allowedMentions: { users: [requesterId, claimerId] }
    }).catch(() => null);

    // Ghim tin mở kênh: kênh đơn chạy vài ngày thì nút huỷ trôi mất, và người cần nó nhất là
    // người đang bực — không nên bắt họ cuộn ngược tìm.
    await opening?.pin().catch(() => {});

    return channel as TextChannel;
}

export interface CloseOrderChannelOptions {
    channel: TextChannel;
    requestId: number;
    requesterId: string;
    claimerId: string | null;
    reason: string;
    /** Câu nhắc cuối gửi vào kênh trước khi xoá (ví dụ: nhắc đánh giá). */
    farewell?: string | null;
}

/**
 * Lưu transcript vào kênh log rồi xoá kênh đơn sau 5 giây.
 * Thứ tự transcript-trước-khi-xoá là bắt buộc: đóng đơn mà mất nội dung là mất đúng thứ
 * cần đến khi hai bên tranh chấp vài tuần sau.
 */
export async function closeOrderChannel(options: CloseOrderChannelOptions): Promise<void> {
    const { channel, requestId, requesterId, claimerId, reason, farewell } = options;

    const transcript = await buildTranscript(
        channel,
        `Đơn #${requestId} · khách ${requesterId} · người nhận ${claimerId || 'không có'} · ${reason}`
    ).catch(() => null);

    await sendMessageLog(channel.client, {
        embeds: [new EmbedBuilder()
            .setColor('#95a5a6')
            .setTitle(`Kênh đơn #${requestId} đã đóng`)
            .addFields(
                { name: 'Khách', value: `<@${requesterId}>`, inline: true },
                { name: 'Người nhận', value: claimerId ? `<@${claimerId}>` : '*không có*', inline: true },
                { name: 'Lý do', value: reason.slice(0, 1000), inline: false }
            )
            .setTimestamp()],
        files: transcript ? [transcript] : undefined
    }).catch(() => {});

    await channel.send({
        content: `${config.ui.emojis.close} ${farewell || 'Đơn đã đóng.'}\nKênh sẽ bị xoá sau 5 giây.`,
        allowedMentions: { users: [requesterId] }
    }).catch(() => {});

    setTimeout(() => {
        // Xin phép ngay trước lúc xoá, không phải lúc hẹn giờ: phép có TTL 20 giây. Thiếu
        // phép thì guardChannelDelete khôi phục lại kênh này thành một kênh zombie mà không
        // đơn nào trỏ tới.
        markInternalAntiRaidAction('channelDelete', channel.id);
        channel.delete(`Đơn #${requestId}: ${reason}`).catch(() => {});
    }, 5_000);
}
