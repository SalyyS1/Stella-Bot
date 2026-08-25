import { Guild, GuildTextBasedChannel, PermissionFlagsBits, TextChannel } from 'discord.js';
import prisma from '../../lib/prisma';

// Lockdown: khoá quyền gửi tin của `@everyone` trên một kênh, và mở lại đúng như cũ.
//
// Chốt quan trọng nhất ở đây là cách MỞ khoá: xoá overwrite về `null`, không set `true`.
// Set `true` sẽ ghi đè cấu hình gốc — một kênh mà admin cố ý để `@everyone` không gửi
// được (kênh thông báo) sẽ bị "mở khoá" thành kênh ai cũng chat được, và không ai nối
// được chuyện đó với lệnh lockdown chạy tuần trước.
//
// Bảng ChannelLock trả lời "kênh nào CHÍNH BOT đã khoá", để `/lockdown lift` không gỡ
// luôn những overwrite admin đặt tay từ trước.

export interface LockResult {
    channelId: string;
    ok: boolean;
    error?: string;
}

function canManage(guild: Guild): boolean {
    return guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels) ?? false;
}

export async function lockChannel(
    channel: GuildTextBasedChannel,
    actorId: string,
    reason: string | null
): Promise<LockResult> {
    if (!canManage(channel.guild)) {
        return { channelId: channel.id, ok: false, error: 'Bot thiếu quyền Manage Channels' };
    }

    const applied = await (channel as TextChannel).permissionOverwrites
        .edit(channel.guild.id, { SendMessages: false }, { reason: `Lockdown: ${reason || 'không ghi lý do'}` })
        .then(() => true)
        .catch(() => false);
    if (!applied) return { channelId: channel.id, ok: false, error: 'Không sửa được quyền kênh' };

    await prisma.channelLock.upsert({
        where: { channelId: channel.id },
        update: { actorId, reason },
        create: { channelId: channel.id, actorId, reason }
    }).catch(() => {});

    return { channelId: channel.id, ok: true };
}

export async function unlockChannel(channel: GuildTextBasedChannel): Promise<LockResult> {
    if (!canManage(channel.guild)) {
        return { channelId: channel.id, ok: false, error: 'Bot thiếu quyền Manage Channels' };
    }

    // `null` = xoá hẳn dòng overwrite này, trả kênh về đúng trạng thái trước lockdown.
    const applied = await (channel as TextChannel).permissionOverwrites
        .edit(channel.guild.id, { SendMessages: null }, { reason: 'Mở lockdown' })
        .then(() => true)
        .catch(() => false);
    if (!applied) return { channelId: channel.id, ok: false, error: 'Không sửa được quyền kênh' };

    await prisma.channelLock.deleteMany({ where: { channelId: channel.id } }).catch(() => {});
    return { channelId: channel.id, ok: true };
}

export async function listLocks() {
    return prisma.channelLock.findMany({ orderBy: { createdAt: 'asc' } }).catch(() => []);
}

export async function isLocked(channelId: string): Promise<boolean> {
    const row = await prisma.channelLock.findUnique({ where: { channelId } }).catch(() => null);
    return Boolean(row);
}

/** Mở mọi kênh mà bot đã khoá. Chỉ đụng kênh có row — không quét cả server. */
export async function liftAllLocks(guild: Guild): Promise<LockResult[]> {
    const locks = await listLocks();
    const results: LockResult[] = [];

    for (const lock of locks) {
        const channel = await guild.channels.fetch(lock.channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) {
            // Kênh đã bị xoá: dọn row để danh sách không giữ rác vĩnh viễn.
            await prisma.channelLock.deleteMany({ where: { channelId: lock.channelId } }).catch(() => {});
            results.push({ channelId: lock.channelId, ok: true });
            continue;
        }
        results.push(await unlockChannel(channel as GuildTextBasedChannel));
    }

    return results;
}
