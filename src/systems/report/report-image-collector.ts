import { Client, TextChannel } from 'discord.js';
import { config } from '../../config';
import { AiImagePart } from '../aiClient';
import { isAllowedImageUrl } from '../discord-image-filter';
import { displayNameOf } from './report-chunk-collector';

// Collects member-posted images from ONE time window so the chunk summarizer can
// actually look at what was shared, instead of recording "ai đó đăng 1 ảnh".
//
// Two hard limits shape this module. Channels are whitelisted rather than taken
// from report.sourceChannels: showcase/share are places people deliberately post
// work for others to see, whereas a general chat channel carries incidental
// screenshots (DMs, personal photos) that nobody uploaded expecting a machine to
// describe them. And the per-window count is capped because each image costs far
// more than the text around it.
//
// Đường quyết định host nào được phép nằm ở discord-image-filter — dùng chung với
// chat Q&A để hai nơi không lệch whitelist.

// Discord serves attachments from its own CDN. Anything else is refused: the URL
// is handed to a third-party AI to fetch, so discord-image-filter is the one place
// that decides what host that request can reach.

export interface CollectedImage {
    part: AiImagePart;
    // Who posted it and where, so the summary can attribute the picture instead of
    // describing it as if it appeared from nowhere.
    label: string;
}

// Read one channel's window for image attachments, paging back through history
// the same way the text collector does.
//
// The single-page version this replaces only ever looked at the 100 most recent
// messages, and that was the bug behind "có nhiều ảnh lắm nhưng nó vẫn báo không
// thấy ảnh": history is read newest-first, so reaching a window that closed hours
// ago means stepping over everything posted since. For a live slot the window is
// usually still inside that first page; for a backfill — and `/maintenance report
// rebuild` makes EVERY window a backfill — it essentially never is, so every slot
// came back with zero pictures no matter how many people had posted.
//
// The loop's real bound is the timestamp check, exactly as in the text walk;
// maxPages only stops a pathological channel from looping forever. It also exits
// the moment the budget is full, so a busy recent window still costs one page.
async function collectChannelImages(
    client: Client,
    channelId: string,
    sinceMs: number,
    untilMs: number,
    remaining: number,
    maxPages: number
): Promise<CollectedImage[]> {
    if (remaining <= 0) return [];
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !('messages' in channel)) return [];

    const channelName = 'name' in channel ? (channel as TextChannel).name : channelId;
    const out: CollectedImage[] = [];
    let before: string | undefined;

    for (let page = 0; page < maxPages; page++) {
        const batch = await (channel as TextChannel).messages
            .fetch({ limit: 100, ...(before ? { before } : {}) })
            .catch(() => null);
        if (!batch || batch.size === 0) break;

        let reachedStart = false;

        for (const msg of batch.values()) {
            before = msg.id;
            if (msg.author.bot) continue;
            // Older than the window: history only gets older from here, so stop.
            // Checked before the budget test so the walk can't spin on a channel
            // whose window is long past.
            if (msg.createdTimestamp < sinceMs) {
                reachedStart = true;
                continue;
            }
            // Same two-sided window as the text collector, so an image is attributed
            // to exactly one slot and never summarized twice.
            if (msg.createdTimestamp >= untilMs) continue;
            if (out.length >= remaining) break;

            for (const attachment of msg.attachments.values()) {
                if (out.length >= remaining) break;
                if (!isAllowedImageUrl(attachment.url)) continue;
                if (attachment.size > config.report.vision.maxBytesPerImage) continue;

                // The URL goes through WHOLE, query string included. The gateway
                // fetches the picture server-side rather than receiving bytes from us
                // (a probe against a host that blocks hotlinking came back with
                // param: "url", "Error while downloading file"), and Discord CDN links
                // carry their signature in ?ex=&is=&hm=. Strip or rebuild that query
                // and every image turns into a download failure.
                //
                // It also means the link has to still be valid when the summary runs,
                // not when the message was posted — which is why images stay
                // best-effort and never gate a slot.
                out.push({
                    part: { type: 'image_url', image_url: { url: attachment.url } },
                    // Cùng cách gọi tên với transcript (nickname trước, username sau
                    // cùng). Nếu chỗ này dùng username thì một người sẽ xuất hiện
                    // dưới HAI cái tên trong cùng bản tin — phần chat gọi họ một
                    // kiểu, phần ảnh gọi kiểu khác — và người đọc sẽ tưởng là hai
                    // người khác nhau.
                    label: `${displayNameOf(msg)} đăng ở #${channelName}`
                });
            }
        }

        if (reachedStart || out.length >= remaining) break;
    }

    return out;
}

// Gather images across the whitelisted channels for one window, capped globally.
//
// maxPages is passed in by the caller for the same reason the text collector takes
// it: a backfilled window sits far behind the newest message, so it needs a much
// larger page budget than a live slot to be reached at all.
export async function collectChunkImages(
    client: Client,
    sinceMs: number,
    untilMs: number,
    maxPages = config.report.chunk.maxPagesPerChannel
): Promise<CollectedImage[]> {
    if (!config.report.vision.enabled) return [];

    const out: CollectedImage[] = [];
    for (const channelId of config.report.vision.channels) {
        const remaining = config.report.vision.maxImagesPerChunk - out.length;
        if (remaining <= 0) break;
        const found = await collectChannelImages(
            client,
            channelId,
            sinceMs,
            untilMs,
            remaining,
            maxPages
        ).catch(() => [] as CollectedImage[]);
        out.push(...found);
    }
    return out;
}
