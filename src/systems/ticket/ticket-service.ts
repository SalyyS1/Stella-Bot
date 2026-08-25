import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    EmbedBuilder,
    Guild,
    GuildMember,
    OverwriteResolvable,
    PermissionFlagsBits,
    TextChannel
} from 'discord.js';
import { config } from '../../config';
import { markInternalAntiRaidAction } from '../antiRaidManager';
import { sendMessageLog } from '../logs/message-log-sender';
import { buildTranscript } from './ticket-transcript';
import {
    closeTicketRow,
    countOpenTickets,
    createTicketRow,
    getTicketByChannel,
    getTicketConfig
} from './ticket-store';

// Ticket: kênh riêng giữa một member và staff.
//
// Chốt quan trọng nhất nằm ở `channels.create`: quyền được truyền NGAY trong lời gọi tạo
// kênh, không phải sửa sau. Tạo kênh rồi mới gỡ `ViewChannel` của @everyone để lại một
// khoảng vài trăm ms mà cả server đọc được — và ticket thường là chỗ người ta kể chuyện
// họ không muốn kể công khai.

export function panelPayload() {
    return {
        embeds: [new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle(`${config.ui.emojis.contact} Cần liên hệ ban quản trị?`)
            .setDescription(
                'Bấm nút bên dưới để mở một kênh riêng chỉ bạn và ban quản trị thấy.\n\n' +
                'Dùng cho: báo cáo thành viên, khiếu nại hình phạt, hỏi việc riêng, báo lỗi.\n' +
                '-# Đừng mở ticket để hỏi những việc chat công khai được — trả lời ở kênh chat nhanh hơn.'
            )],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('ticket_open').setLabel('Mở ticket').setEmoji('📩').setStyle(ButtonStyle.Primary)
        )]
    };
}

function ticketControlRow(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('ticket_claim').setLabel('Nhận xử lý').setEmoji('🙋').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('ticket_close').setLabel('Đóng ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger)
    );
}

export interface OpenTicketResult {
    ok: boolean;
    channelId?: string;
    error?: string;
}

export async function openTicket(member: GuildMember, topic: string): Promise<OpenTicketResult> {
    const guild = member.guild;
    const settings = await getTicketConfig(guild.id);
    if (!settings) return { ok: false, error: 'Ticket chưa được cấu hình. Nhờ admin chạy `/ticket setup`.' };

    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return { ok: false, error: 'Stella thiếu quyền Manage Channels nên không tạo được kênh ticket.' };
    }

    // Trần mỗi người: không có nó thì một người bấm nút 50 lần là server có 50 kênh và
    // không ai dọn được bằng tay.
    const open = await countOpenTickets(member.id);
    if (open >= settings.maxPerUser) {
        return { ok: false, error: `Bạn đang có ${open} ticket mở (trần ${settings.maxPerUser}). Đóng bớt trước nhé.` };
    }

    const overwrites: OverwriteResolvable[] = [
        // @everyone mất quyền xem — đặt ngay lúc tạo, xem comment đầu file.
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
            id: member.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles
            ]
        }
    ];
    if (guild.members.me) {
        overwrites.push({
            id: guild.members.me.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageMessages
            ]
        });
    }
    if (settings.staffRoleId && guild.roles.cache.has(settings.staffRoleId)) {
        overwrites.push({
            id: settings.staffRoleId,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles
            ]
        });
    }

    // Tạo row TRƯỚC để lấy số ticket, nhưng cần channelId... nên tạo kênh với tên tạm rồi
    // đổi tên theo id là hai lần gọi API. Thay vào đó: đếm tổng ticket để đặt tên, và id
    // thật vẫn được ghi trong embed. Tên kênh không cần trùng khớp id tuyệt đối.
    // Xin phép anti-raid TRƯỚC khi tạo: guardChannelCreate coi mọi kênh Stella tạo mà
    // không có phép là dấu hiệu token bị chiếm.
    markInternalAntiRaidAction('channelCreate', '*');
    const channel = await guild.channels.create({
        name: `ticket-${member.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 90) || 'ticket',
        type: ChannelType.GuildText,
        parent: settings.categoryId || undefined,
        permissionOverwrites: overwrites,
        reason: `Ticket của ${member.user.tag}`
    }).catch(error => {
        console.error('[ticket] tạo kênh lỗi:', error);
        return null;
    });
    if (!channel) return { ok: false, error: 'Không tạo được kênh ticket.' };

    const row = await createTicketRow({ channelId: channel.id, openerId: member.id, topic }).catch(async error => {
        // Ghi DB hỏng mà để kênh lại thì kênh đó thành rác không ai nhận.
        console.error('[ticket] ghi DB lỗi, xoá kênh vừa tạo:', error);
        markInternalAntiRaidAction('channelDelete', channel.id);
        await channel.delete('Không ghi được ticket vào DB').catch(() => {});
        return null;
    });
    if (!row) return { ok: false, error: 'Không lưu được ticket.' };

    await channel.send({
        content: `<@${member.id}>${settings.staffRoleId ? ` · <@&${settings.staffRoleId}>` : ''}`,
        embeds: [new EmbedBuilder()
            .setColor('#2ecc71')
            .setTitle(`Ticket #${row.id}`)
            .setDescription(`**Chủ đề:** ${topic}\n\nBan quản trị sẽ trả lời ở đây. Kể càng rõ càng nhanh được xử.`)
            .setFooter({ text: 'Đóng bằng nút bên dưới hoặc /ticket close' })
            .setTimestamp()],
        components: [ticketControlRow()],
        // Ping người mở và role staff là ĐÚNG mục đích ở đây, nhưng không cho nội dung
        // chủ đề (do người dùng nhập) ping thêm ai khác.
        allowedMentions: { users: [member.id], roles: settings.staffRoleId ? [settings.staffRoleId] : [] }
    }).catch(() => {});

    return { ok: true, channelId: channel.id };
}

export interface CloseResult {
    ok: boolean;
    error?: string;
}

export async function closeTicket(
    channel: TextChannel,
    closerId: string,
    reason: string | null
): Promise<CloseResult> {
    const ticket = await getTicketByChannel(channel.id);
    if (!ticket) return { ok: false, error: 'Kênh này không phải ticket.' };
    if (ticket.closedAt) return { ok: false, error: 'Ticket này đã đóng.' };

    // Transcript TRƯỚC khi xoá kênh: đóng ticket mà mất nội dung là mất đúng thứ người ta
    // sẽ cần khi vụ việc quay lại sau vài tuần.
    const transcript = await buildTranscript(
        channel,
        `Ticket #${ticket.id} · chủ đề: ${ticket.topic} · mở bởi ${ticket.openerId} · đóng bởi ${closerId}`
    ).catch(() => null);

    await closeTicketRow(channel.id, closerId);

    await sendMessageLog(channel.client, {
        embeds: [new EmbedBuilder()
            .setColor('#95a5a6')
            .setTitle(`Ticket #${ticket.id} đã đóng`)
            .addFields(
                { name: 'Người mở', value: `<@${ticket.openerId}>`, inline: true },
                { name: 'Người đóng', value: `<@${closerId}>`, inline: true },
                { name: 'Nhận xử lý', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '*không ai*', inline: true },
                { name: 'Chủ đề', value: ticket.topic.slice(0, 1000), inline: false },
                ...(reason ? [{ name: 'Lý do đóng', value: reason.slice(0, 1000), inline: false }] : [])
            )
            .setTimestamp()],
        files: transcript ? [transcript] : undefined
    }).catch(() => {});

    await channel.send(`${config.ui.emojis.close} Ticket đã đóng. Kênh sẽ bị xoá sau 5 giây.`).catch(() => {});
    setTimeout(() => {
        // Xin phép ngay trước lúc xoá, không phải lúc hẹn giờ: phép có TTL 20 giây.
        markInternalAntiRaidAction('channelDelete', channel.id);
        channel.delete('Ticket đã đóng').catch(() => {});
    }, 5_000);
    return { ok: true };
}

/** Người này có phải staff của hệ thống ticket? */
export async function isTicketStaff(member: GuildMember): Promise<boolean> {
    if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
    const settings = await getTicketConfig(member.guild.id);
    return Boolean(settings?.staffRoleId && member.roles.cache.has(settings.staffRoleId));
}

/** Đăng hoặc cập nhật panel. Sửa tin cũ thay vì đăng panel thứ hai. */
export async function publishPanel(guild: Guild, channelId: string): Promise<string> {
    const settings = await getTicketConfig(guild.id);
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) throw new Error(`Không gửi được vào <#${channelId}>.`);

    if (settings?.panelMessageId && settings.panelChannelId === channelId) {
        const edited = await (channel as TextChannel).messages.fetch(settings.panelMessageId)
            .then(message => message.edit(panelPayload()))
            .catch(() => null);
        if (edited) return edited.url;
    }
    if (settings?.panelMessageId && settings.panelChannelId && settings.panelChannelId !== channelId) {
        // Panel cũ ở kênh khác phải biến mất, nếu không server có hai panel sống.
        const old = await guild.channels.fetch(settings.panelChannelId).catch(() => null);
        if (old?.isTextBased()) {
            await (old as TextChannel).messages.fetch(settings.panelMessageId)
                .then(message => message.delete())
                .catch(() => {});
        }
    }

    const sent = await (channel as TextChannel).send(panelPayload());
    return sent.url;
}
