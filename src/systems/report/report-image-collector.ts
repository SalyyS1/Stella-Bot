import { Client, TextChannel } from 'discord.js';
import { config } from '../../config';
import { AiImagePart } from '../aiClient';

// Collects member-posted images from ONE time window so the chunk summarizer can
// actually look at what was shared, instead of recording "ai đó đăng 1 ảnh".
//
// Two hard limits shape this module. Channels are whitelisted rather than taken
// from report.sourceChannels: showcase/share are places people deliberately post
// work for others to see, whereas a general chat channel carries incidental
// screenshots (DMs, personal photos) that nobody uploaded expecting a machine to
// describe them. And the per-window count is capped because each image costs far
// more than the text around it.

// Discord serves attachments from its own CDN. Anything else is refused: the URL
// is handed to a third-party AI to fetch, so this is the one place that decides
// what host that request can reach.
const ALLOWED_IMAGE_HOSTS = new Set([
    'cdn.discordapp.com',
    'media.discordapp.net'
]);

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

function isAllowedImageUrl(raw: string): boolean {
    try {
        const url = new URL(raw);
        if (url.protocol !== 'https:') return false;
        if (!ALLOWED_IMAGE_HOSTS.has(url.hostname.toLowerCase())) return false;
        // Extension is checked on the PATH, not the full URL: Discord CDN links
        // carry query parameters (?ex=&is=&hm=) that would otherwise defeat a
        // naive endsWith on the whole string.
        const path = url.pathname.toLowerCase();
        return IMAGE_EXTENSIONS.some(ext => path.endsWith(ext));
    } catch {
        return false;
    }
}

export interface CollectedImage {
    part: AiImagePart;
    // Who posted it and where, so the summary can attribute the picture instead of
    // describing it as if it appeared from nowhere.
    label: string;
}

// Read one channel's window for image attachments. Deliberately a single page,
// which has a real consequence worth naming: only the 100 most recent messages
// are examined, so a window that has since scrolled past that — an old slot being
// backfilled, or a very busy channel — yields no images at all. That is accepted
// rather than fixed. Pictures are an enrichment; the text summary is the part the
// bulletin depends on, and paging history a second time for a best-effort extra
// would double the Discord traffic of every window.
async function collectChannelImages(
    client: Client,
    channelId: string,
    sinceMs: number,
    untilMs: number,
    remaining: number
): Promise<CollectedImage[]> {
    if (remaining <= 0) return [];
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !('messages' in channel)) return [];

    const batch = await (channel as TextChannel).messages
        .fetch({ limit: 100 })
        .catch(() => null);
    if (!batch) return [];

    const channelName = 'name' in channel ? (channel as TextChannel).name : channelId;
    const out: CollectedImage[] = [];

    for (const msg of batch.values()) {
        if (out.length >= remaining) break;
        if (msg.author.bot) continue;
        // Same two-sided window as the text collector, so an image is attributed to
        // exactly one slot and never summarized twice.
        if (msg.createdTimestamp < sinceMs) continue;
        if (msg.createdTimestamp >= untilMs) continue;

        for (const attachment of msg.attachments.values()) {
            if (out.length >= remaining) break;
            const isImage = attachment.contentType?.startsWith('image/')
                || isAllowedImageUrl(attachment.url);
            if (!isImage) continue;
            if (!isAllowedImageUrl(attachment.url)) continue;
            if (attachment.size > config.report.vision.maxBytesPerImage) continue;

            // The URL goes through WHOLE, query string included. The gateway fetches
            // the picture server-side rather than receiving bytes from us (a probe
            // against a host that blocks hotlinking came back with
            // param: "url", "Error while downloading file"), and Discord CDN links
            // carry their signature in ?ex=&is=&hm=. Strip or rebuild that query and
            // every image turns into a download failure.
            //
            // It also means the link has to still be valid when the summary runs, not
            // when the message was posted — which is a second reason images are
            // best-effort and never gate a slot.
            out.push({
                part: { type: 'image_url', image_url: { url: attachment.url } },
                label: `${msg.author.username} đăng ở #${channelName}`
            });
        }
    }

    return out;
}

// Gather images across the whitelisted channels for one window, capped globally.
export async function collectChunkImages(
    client: Client,
    sinceMs: number,
    untilMs: number
): Promise<CollectedImage[]> {
    if (!config.report.vision.enabled) return [];

    const out: CollectedImage[] = [];
    for (const channelId of config.report.vision.channels) {
        const remaining = config.report.vision.maxImagesPerChunk - out.length;
        if (remaining <= 0) break;
        const found = await collectChannelImages(client, channelId, sinceMs, untilMs, remaining)
            .catch(() => [] as CollectedImage[]);
        out.push(...found);
    }
    return out;
}
