import {
    ChannelType,
    Guild,
    GuildMember,
    PermissionFlagsBits,
    VoiceBasedChannel,
    VoiceState
} from 'discord.js';
import { config } from '../../config';
import { sendAdminLog } from '../../utils/adminLog';
import { markInternalAntiRaidAction } from '../antiRaidManager';
import { buildPanelPayload } from './tempvoice-panel';
import {
    countRooms,
    countRoomsByOwner,
    createRoom,
    deleteRoom,
    getHub,
    getRoom,
    listRooms
} from './tempvoice-store';

// Vòng đời phòng voice tạm.
//
// Chỉ đụng tới kênh có row trong bảng temp voice. Hệ thống nhạc cũng sống trong voice;
// một hàm dọn "kênh voice rỗng" mà không phân biệt sẽ xoá cả kênh voice thật của server.

// Hẹn giờ xoá phòng rỗng. Giữ trong RAM vì nó chỉ sống vài giây; mất khi restart thì
// `reconcileTempVoiceChannels` lúc bot lên dọn nốt.
const pendingDeletes = new Map<string, NodeJS.Timeout>();

function cancelPendingDelete(channelId: string): void {
    const timer = pendingDeletes.get(channelId);
    if (timer) {
        clearTimeout(timer);
        pendingDeletes.delete(channelId);
    }
}

/** Tên kênh do người dùng đặt: bỏ xuống dòng và cắt độ dài theo giới hạn của Discord. */
export function sanitizeRoomName(raw: string): string {
    const cleaned = raw.replace(/[\r\n`]/g, ' ').replace(/\s+/g, ' ').trim();
    return cleaned.slice(0, 90) || 'Phòng riêng';
}

async function postPanel(channel: VoiceBasedChannel, ownerId: string): Promise<void> {
    await (channel as any)
        .send({
            ...buildPanelPayload({
                channelId: channel.id,
                ownerId,
                locked: false,
                hidden: false,
                userLimit: channel.userLimit ?? 0
            }),
            content: `<@${ownerId}>`,
            allowedMentions: { users: [ownerId] }
        })
        .catch((error: any) => console.error('[tempvoice] không đăng được panel:', error?.message || error));
}

async function createRoomForMember(member: GuildMember, hubChannel: VoiceBasedChannel): Promise<void> {
    const hub = await getHub(hubChannel.id);
    if (!hub) return;

    const guild = member.guild;
    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
        await sendAdminLog(guild.client, {
            title: 'Temp voice: thiếu quyền',
            color: '#e67e22',
            description: 'Bot cần quyền **Manage Channels** để tạo phòng voice tạm.'
        }).catch(() => {});
        return;
    }

    // Trần cứng: join-leave liên tục ở hub là cách tạo hàng trăm kênh trong một phút.
    if (await countRooms() >= config.tempVoice.maxChannels) {
        await member.voice.disconnect('Đã đạt trần số phòng tạm').catch(() => {});
        await member.send(`${config.ui.emojis.error} Server đang đạt trần ${config.tempVoice.maxChannels} phòng tạm. Thử lại sau nhé.`).catch(() => {});
        return;
    }
    if (await countRoomsByOwner(member.id) >= config.tempVoice.maxPerUser) {
        await member.send(`${config.ui.emojis.error} Bạn đang có một phòng rồi. Rời phòng cũ trước khi tạo phòng mới.`).catch(() => {});
        return;
    }

    const name = sanitizeRoomName(hub.nameTemplate.replace('{user}', member.displayName));
    // Xin phép anti-raid TRƯỚC khi tạo: guardChannelCreate coi mọi kênh Stella tạo mà
    // không có phép là dấu hiệu token bị chiếm.
    markInternalAntiRaidAction('channelCreate', '*');
    const channel = await guild.channels.create({
        name,
        type: ChannelType.GuildVoice,
        parent: hub.categoryId || hubChannel.parentId || undefined,
        userLimit: hub.userLimit || undefined,
        reason: `Phòng voice tạm của ${member.user.tag}`
    }).catch(error => {
        console.error('[tempvoice] tạo kênh lỗi:', error);
        return null;
    });
    if (!channel) return;

    await createRoom({ channelId: channel.id, hubId: hub.channelId, ownerId: member.id }).catch(async error => {
        // Ghi DB hỏng mà vẫn để kênh lại thì kênh đó thành rác không ai nhận. Dọn ngay.
        console.error('[tempvoice] ghi DB lỗi, xoá kênh vừa tạo:', error);
        markInternalAntiRaidAction('channelDelete', channel.id);
        await channel.delete('Không ghi được vào DB').catch(() => {});
        return null;
    });

    // Move người tạo vào phòng. Họ có thể đã rời hub trong lúc bot tạo kênh — khi đó
    // phòng rỗng và sẽ bị dọn theo đường thường, không cần xử lý riêng.
    await member.voice.setChannel(channel).catch(() => {});
    await postPanel(channel, member.id);
}

async function deleteRoomIfEmpty(channel: VoiceBasedChannel): Promise<void> {
    cancelPendingDelete(channel.id);
    const room = await getRoom(channel.id);
    if (!room) return;
    if (channel.members.size > 0) return;

    markInternalAntiRaidAction('channelDelete', channel.id);
    await channel.delete('Phòng voice tạm không còn ai').catch(() => {});
    await deleteRoom(channel.id);
}

function scheduleEmptyCheck(channel: VoiceBasedChannel): void {
    cancelPendingDelete(channel.id);
    // Xoá ngay lập tức làm người rớt mạng vài giây quay lại thì phòng đã biến mất — kèm
    // theo là mất cả quyền chủ phòng và cấu hình họ vừa đặt.
    const timer = setTimeout(() => {
        pendingDeletes.delete(channel.id);
        const fresh = channel.guild.channels.cache.get(channel.id) as VoiceBasedChannel | undefined;
        if (fresh) void deleteRoomIfEmpty(fresh);
        else void deleteRoom(channel.id);
    }, config.tempVoice.emptyGraceMs);
    pendingDeletes.set(channel.id, timer);
}

export async function handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
    if (!config.tempVoice.enabled) return;

    // Rời một phòng tạm → hẹn giờ dọn nếu phòng trống.
    if (oldState.channelId && oldState.channelId !== newState.channelId) {
        const left = oldState.channel;
        if (left && await getRoom(left.id)) {
            if (left.members.size === 0) scheduleEmptyCheck(left);
        }
    }

    if (!newState.channelId || oldState.channelId === newState.channelId) return;
    const joined = newState.channel;
    const member = newState.member;
    if (!joined || !member || member.user.bot) return;

    // Vào lại phòng đang chờ xoá → huỷ hẹn giờ.
    cancelPendingDelete(joined.id);

    if (await getHub(joined.id)) {
        await createRoomForMember(member, joined);
    }
}

/**
 * Dọn phòng mồ côi lúc bot lên.
 *
 * Bắt buộc phải có: hẹn giờ xoá nằm trong RAM, nên bot chết giữa lúc có phòng rỗng sẽ
 * để lại kênh đó sống mãi. Sau vài lần restart là server đầy kênh rác mà không ai biết
 * cái nào còn dùng.
 */
export async function reconcileTempVoiceChannels(guild: Guild): Promise<number> {
    const rooms = await listRooms();
    let cleaned = 0;

    for (const room of rooms) {
        const channel = await guild.channels.fetch(room.channelId).catch(() => null);
        if (!channel) {
            await deleteRoom(room.channelId);
            cleaned++;
            continue;
        }
        if (channel.type === ChannelType.GuildVoice && channel.members.size === 0) {
            markInternalAntiRaidAction('channelDelete', channel.id);
            await channel.delete('Phòng voice tạm còn sót sau khi bot restart').catch(() => {});
            await deleteRoom(room.channelId);
            cleaned++;
        }
    }

    if (cleaned) console.log(`[tempvoice] đã dọn ${cleaned} phòng mồ côi.`);
    return cleaned;
}
