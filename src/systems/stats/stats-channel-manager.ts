import { ChannelType, Client, GatewayIntentBits, Guild, PermissionFlagsBits, VoiceChannel } from 'discord.js';
import prisma from '../../lib/prisma';
import { config } from '../../config';

// Kênh thống kê: kênh voice chỉ dùng làm nhãn, tên do bot cập nhật định kỳ.
//
// ĐỌC COMMENT NÀY TRƯỚC KHI ĐỔI NHỊP: Discord chỉ cho đổi tên một kênh 2 lần mỗi 10 phút.
// Vượt trần thì `setName` KHÔNG ném lỗi — discord.js giữ request trong hàng đợi
// rate-limit tới khi hết hạn, và mọi request khác của bot xếp hàng sau nó. Một kênh thống
// kê đặt nhịp 1 phút có thể làm cả bot đứng, và triệu chứng nhìn giống "bot lag".
//
// Hai lớp bảo vệ: sàn cứng `config.stats.minIntervalMs`, và chỉ gọi `setName` khi tên mới
// KHÁC tên hiện tại (số member không đổi trong 15 phút là chuyện thường, mà một lần gọi
// vô ích vẫn tiêu một lượt trong trần 2/10 phút).

export type StatsKind = 'members' | 'humans' | 'bots' | 'online' | 'voice' | 'boosts';

export const STATS_KINDS: { value: StatsKind; label: string; needsPresence?: boolean }[] = [
    { value: 'members', label: 'Thành viên' },
    { value: 'humans', label: 'Người thật' },
    { value: 'bots', label: 'Bot' },
    { value: 'online', label: 'Đang online', needsPresence: true },
    { value: 'voice', label: 'Đang trong voice' },
    { value: 'boosts', label: 'Boost' }
];

export function hasPresenceIntent(client: Client): boolean {
    return client.options.intents.has(GatewayIntentBits.GuildPresences);
}

function computeValue(guild: Guild, kind: StatsKind): number {
    switch (kind) {
        case 'members':
            // `memberCount` là con số Discord trả sẵn — đếm cache sẽ sai sau restart vì
            // cache chưa nạp hết member.
            return guild.memberCount;
        case 'humans':
            return guild.members.cache.filter(member => !member.user.bot).size;
        case 'bots':
            return guild.members.cache.filter(member => member.user.bot).size;
        case 'online':
            return guild.members.cache.filter(member =>
                !member.user.bot && member.presence && member.presence.status !== 'offline'
            ).size;
        case 'voice':
            return guild.channels.cache
                .filter(channel => channel.type === ChannelType.GuildVoice)
                .reduce((sum, channel) => sum + (channel as VoiceChannel).members.filter(m => !m.user.bot).size, 0);
        case 'boosts':
            return guild.premiumSubscriptionCount ?? 0;
    }
}

export async function listStatsChannels() {
    return prisma.statsChannel.findMany().catch(() => []);
}

export async function createStatsChannel(input: {
    guild: Guild;
    kind: StatsKind;
    label: string;
    createdBy: string;
    categoryId?: string | null;
}): Promise<string> {
    const value = computeValue(input.guild, input.kind);
    const channel = await input.guild.channels.create({
        name: `${input.label}: ${value}`.slice(0, 100),
        type: ChannelType.GuildVoice,
        parent: input.categoryId || undefined,
        // Không ai cần vào một cái nhãn. Khoá `Connect` chứ không khoá `ViewChannel` —
        // mục đích của kênh này là để mọi người ĐỌC thấy tên nó ở sidebar.
        permissionOverwrites: [{ id: input.guild.id, deny: [PermissionFlagsBits.Connect] }],
        reason: 'Kênh thống kê'
    });

    await prisma.statsChannel.create({
        data: { channelId: channel.id, kind: input.kind, label: input.label, createdBy: input.createdBy }
    }).catch(async error => {
        console.error('[stats] ghi DB lỗi, xoá kênh vừa tạo:', error);
        await channel.delete('Không ghi được vào DB').catch(() => {});
        throw error;
    });

    return channel.id;
}

export async function removeStatsChannel(channelId: string, guild: Guild, deleteChannel: boolean): Promise<boolean> {
    const removed = await prisma.statsChannel.deleteMany({ where: { channelId } }).catch(() => ({ count: 0 }));
    if (removed.count && deleteChannel) {
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        await channel?.delete('Gỡ kênh thống kê').catch(() => {});
    }
    return removed.count > 0;
}

/** Cập nhật mọi kênh thống kê. Trả về số kênh đã thật sự đổi tên. */
export async function refreshStatsChannels(guild: Guild): Promise<number> {
    const rows = await listStatsChannels();
    let renamed = 0;

    for (const row of rows) {
        const channel = await guild.channels.fetch(row.channelId).catch(() => null);
        if (!channel) {
            // Kênh bị xoá tay: dọn row, nếu không thì mỗi 15 phút lại thử fetch một kênh
            // không còn tồn tại và log lỗi mãi.
            await prisma.statsChannel.deleteMany({ where: { channelId: row.channelId } }).catch(() => {});
            continue;
        }

        const nextName = `${row.label}: ${computeValue(guild, row.kind as StatsKind)}`.slice(0, 100);
        // Chỉ gọi API khi tên thật sự đổi — xem comment đầu file.
        if (channel.name === nextName) continue;

        const ok = await channel.setName(nextName, 'Cập nhật kênh thống kê').then(() => true).catch(error => {
            console.error(`[stats] không đổi được tên kênh ${row.channelId}:`, error?.message || error);
            return false;
        });
        if (ok) renamed++;
    }

    return renamed;
}

export function startStatsScheduler(client: Client): void {
    const interval = Math.max(config.stats.updateIntervalMs, config.stats.minIntervalMs);
    if (config.stats.updateIntervalMs < config.stats.minIntervalMs) {
        console.warn(
            `[stats] updateIntervalMs (${config.stats.updateIntervalMs}ms) dưới sàn an toàn — ` +
            `dùng ${interval}ms để không đụng trần đổi tên kênh của Discord.`
        );
    }

    setInterval(() => {
        const guild = client.guilds.cache.first();
        if (!guild) return;
        void refreshStatsChannels(guild).catch(error => console.error('[stats] refresh lỗi:', error));
    }, interval);
}
