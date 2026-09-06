import { Client, EmbedBuilder } from 'discord.js';
import prisma from '../../lib/prisma';
import { config } from '../../config';
import { sendAdminLog } from '../../utils/adminLog';
import {
    fetchYoutubeFeed,
    newestCursor,
    pickNewVideos,
    resolveChannelId,
    type YoutubeFeed,
    type YoutubeVideo
} from './youtube-feed';

// Theo dõi kênh YouTube và báo video mới.
//
// Chốt quan trọng nhất: lúc THÊM kênh, con trỏ được đặt ngay bằng video mới nhất hiện có.
// Không có bước này thì tick đầu tiên thấy "15 video chưa báo" và dội cả 15 vào chat —
// đó là cách nhanh nhất để admin gỡ tính năng này sau năm phút.

export interface SubscriptionSummary {
    ytChannelId: string;
    ytTitle: string;
    discordChannelId: string;
    pingRoleId: string | null;
    failCount: number;
    lastPublishedAt: Date | null;
}

export async function listSubscriptions(): Promise<SubscriptionSummary[]> {
    return prisma.youtubeSubscription.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
            ytChannelId: true, ytTitle: true, discordChannelId: true,
            pingRoleId: true, failCount: true, lastPublishedAt: true
        }
    });
}

export async function addSubscription(input: {
    channelInput: string;
    discordChannelId: string;
    pingRoleId: string | null;
    addedBy: string;
}): Promise<{ ytChannelId: string; ytTitle: string; latest: YoutubeVideo | null; replaced: boolean }> {
    const ytChannelId = await resolveChannelId(input.channelInput);

    const existing = await prisma.youtubeSubscription.findUnique({ where: { ytChannelId } });
    if (!existing) {
        const total = await prisma.youtubeSubscription.count();
        if (total >= config.youtube.maxSubscriptions) {
            throw new Error(`Đã đủ ${config.youtube.maxSubscriptions} kênh. Gỡ bớt một kênh trước.`);
        }
    }

    // Đọc feed NGAY LÚC THÊM: vừa để lấy tên kênh, vừa là bằng chứng feed đọc được — thêm
    // xong mà tick sau mới biết feed hỏng là admin không bao giờ biết tại sao im lặng.
    const feed = await fetchYoutubeFeed(ytChannelId);
    const cursor = newestCursor(feed.videos);
    const latest = feed.videos[0] ?? null;

    await prisma.youtubeSubscription.upsert({
        where: { ytChannelId },
        update: {
            ytTitle: feed.channelTitle,
            discordChannelId: input.discordChannelId,
            pingRoleId: input.pingRoleId,
            addedBy: input.addedBy,
            failCount: 0
        },
        create: {
            ytChannelId,
            ytTitle: feed.channelTitle,
            discordChannelId: input.discordChannelId,
            pingRoleId: input.pingRoleId,
            addedBy: input.addedBy,
            // Con trỏ đặt ở video mới nhất: từ giờ chỉ báo video đăng SAU lúc thêm.
            lastPublishedAt: cursor?.lastPublishedAt ?? new Date(),
            lastVideoId: cursor?.lastVideoId ?? null
        }
    });

    return { ytChannelId, ytTitle: feed.channelTitle, latest, replaced: Boolean(existing) };
}

/** Gỡ theo ID hoặc theo thứ người dùng dán (handle/link). Trả về tên kênh đã gỡ, null nếu không có. */
export async function removeSubscription(channelInput: string): Promise<string | null> {
    const ytChannelId = await resolveChannelId(channelInput);
    const row = await prisma.youtubeSubscription.findUnique({ where: { ytChannelId } });
    if (!row) return null;
    await prisma.youtubeSubscription.delete({ where: { ytChannelId } });
    return row.ytTitle;
}

function buildVideoEmbed(video: YoutubeVideo, channelTitle: string, ytChannelId: string): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setAuthor({ name: channelTitle, url: `https://www.youtube.com/channel/${ytChannelId}` })
        .setTitle(video.title.slice(0, 256))
        .setURL(video.url)
        .setTimestamp(video.publishedAt)
        .setFooter({ text: 'YouTube' });
    if (video.thumbnailUrl && /^https:\/\/i\d?\.ytimg\.com\//.test(video.thumbnailUrl)) {
        embed.setImage(video.thumbnailUrl);
    }
    return embed;
}

async function announce(
    client: Client,
    sub: { ytChannelId: string; ytTitle: string; discordChannelId: string; pingRoleId: string | null },
    video: YoutubeVideo
): Promise<boolean> {
    const channel = await client.channels.fetch(sub.discordChannelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !channel.isSendable()) return false;

    const ping = sub.pingRoleId ? `<@&${sub.pingRoleId}> ` : '';
    const sent = await channel.send({
        content: `${ping}🎬 **${sub.ytTitle}** vừa đăng video mới!`,
        embeds: [buildVideoEmbed(video, sub.ytTitle, sub.ytChannelId)],
        // Tên kênh và tiêu đề video là chữ từ YouTube — coi như dữ liệu không tin được.
        // Chỉ role được cấu hình mới được ping, không parse gì khác.
        allowedMentions: { parse: [], roles: sub.pingRoleId ? [sub.pingRoleId] : [] }
    }).catch(error => {
        console.error(`[youtube] không gửi được tin vào ${sub.discordChannelId}:`, error?.message || error);
        return null;
    });
    return Boolean(sent);
}

/**
 * Một lượt quét mọi kênh. Trả về số video đã báo.
 *
 * Feed lỗi thì tăng `failCount` và giữ nguyên con trỏ; đúng ngưỡng thì báo admin MỘT lần
 * (không phải mỗi tick). Feed sống lại thì failCount về 0 — tự lành, không cần ai bấm.
 */
export async function pollYoutube(client: Client): Promise<number> {
    const subs = await prisma.youtubeSubscription.findMany();
    let announced = 0;

    for (const sub of subs) {
        let feed: YoutubeFeed;
        try {
            feed = await fetchYoutubeFeed(sub.ytChannelId);
        } catch (error) {
            const failCount = sub.failCount + 1;
            await prisma.youtubeSubscription.update({
                where: { ytChannelId: sub.ytChannelId },
                data: { failCount }
            }).catch(() => {});
            if (failCount === config.youtube.failAlertAfter) {
                await sendAdminLog(client, {
                    title: 'YouTube feed lỗi liên tục',
                    color: '#e67e22',
                    description:
                        `Kênh **${sub.ytTitle}** (\`${sub.ytChannelId}\`) đọc feed lỗi ${failCount} lần liền: ` +
                        `${error instanceof Error ? error.message : String(error)}\n` +
                        'Kênh có thể đã bị xoá hoặc đổi ID. Gỡ bằng `/youtube remove` nếu không còn cần.'
                }).catch(() => {});
            }
            continue;
        }

        const fresh = pickNewVideos(
            feed.videos,
            { lastPublishedAt: sub.lastPublishedAt, lastVideoId: sub.lastVideoId },
            config.youtube.maxPerTick
        );

        for (const video of fresh) {
            if (await announce(client, sub, video)) announced++;
        }

        // Tiến con trỏ tới video mới nhất trong feed kể cả khi không đăng được (kênh Discord
        // mất, thiếu quyền): đứng yên là mỗi tick lại thử đăng đúng những video đó mãi.
        // Tên kênh cũng cập nhật ở đây — kênh YouTube đổi tên thì tin nhắn phải đổi theo.
        const cursor = newestCursor(feed.videos);
        await prisma.youtubeSubscription.update({
            where: { ytChannelId: sub.ytChannelId },
            data: {
                failCount: 0,
                ytTitle: feed.channelTitle,
                ...(cursor && (!sub.lastPublishedAt || cursor.lastPublishedAt > sub.lastPublishedAt)
                    ? { lastPublishedAt: cursor.lastPublishedAt, lastVideoId: cursor.lastVideoId }
                    : {})
            }
        }).catch(error => console.error('[youtube] không cập nhật con trỏ:', error));
    }

    return announced;
}

let busy = false;

export function startYoutubeAlertScheduler(client: Client): void {
    const interval = Math.max(config.youtube.pollIntervalMs, 5 * 60_000);
    const run = async () => {
        if (busy) return;
        busy = true;
        try {
            const count = await pollYoutube(client);
            if (count) console.log(`[youtube] đã báo ${count} video mới.`);
        } catch (error) {
            console.error('[youtube] tick lỗi:', error);
        } finally {
            busy = false;
        }
    };
    // Lượt đầu sau 1 phút chứ không đợi trọn 10 phút: bot restart giữa lúc kênh vừa đăng
    // video thì không nên trễ thêm một nhịp đầy.
    setTimeout(() => void run(), 60_000);
    setInterval(() => void run(), interval);
}
