import { config } from '../../config';

// Đọc feed RSS của YouTube và giải "kênh nào" từ thứ người dùng dán vào.
//
// File này CỐ Ý không import discord.js hay prisma: mọi hàm ở đây là hàm thuần (chuỗi vào,
// dữ liệu ra) trừ hai hàm fetch ở cuối, để test được bằng XML/HTML mẫu mà không cần mạng.
//
// Vì sao tự parse bằng regex thay vì thêm một thư viện XML: feed của YouTube có đúng MỘT
// dạng, do một máy sinh ra, và ta chỉ cần 6 trường. Một dependency XML đầy đủ là thêm RAM
// trên cái host đã từng OOM, để đổi lấy sự tổng quát mà feed này không bao giờ dùng tới.

export interface YoutubeVideo {
    videoId: string;
    title: string;
    url: string;
    publishedAt: Date;
    thumbnailUrl: string | null;
}

export interface YoutubeFeed {
    channelId: string;
    channelTitle: string;
    videos: YoutubeVideo[];
}

const YT_CHANNEL_ID = /^UC[\w-]{22}$/;
const YT_HANDLE = /^@[\w.-]{3,30}$/;

// Chỉ fetch trang trên đúng các host này. Người dùng dán URL vào `/youtube add`, và bot
// fetch URL đó — không chốt host là bot thành máy fetch URL tuỳ ý (SSRF), kể cả địa chỉ
// nội bộ của host.
export const ALLOWED_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);

const BROWSER_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** `&amp;` `&lt;` `&#39;` `&#x27;`... -> ký tự thật. Tiêu đề video có `&` là chuyện thường. */
export function decodeXmlEntities(text: string): string {
    return text
        .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        // &amp; giải CUỐI: "&amp;lt;" là chữ "&lt;" thật, giải sớm sẽ thành "<".
        .replace(/&amp;/g, '&');
}

function tagText(block: string, tag: string): string | null {
    const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(block);
    return match ? decodeXmlEntities(match[1].trim()) : null;
}

function attr(block: string, tag: string, name: string): string | null {
    const match = new RegExp(`<${tag}\\b[^>]*\\s${name}="([^"]*)"`).exec(block);
    return match ? decodeXmlEntities(match[1]) : null;
}

/**
 * Feed Atom của YouTube -> danh sách video, MỚI NHẤT TRƯỚC (đúng thứ tự YouTube trả).
 * Entry thiếu videoId hoặc published không đọc được thì bỏ qua — thà thiếu một video hơn
 * là đăng một tin với link hỏng.
 */
export function parseYoutubeFeed(xml: string): YoutubeFeed | null {
    const firstEntryAt = xml.indexOf('<entry>');
    const head = firstEntryAt === -1 ? xml : xml.slice(0, firstEntryAt);
    const channelId = tagText(head, 'yt:channelId');
    const channelTitle = tagText(head, 'title');
    if (!channelId || !channelTitle) return null;

    const videos: YoutubeVideo[] = [];
    for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
        const block = match[1];
        const videoId = tagText(block, 'yt:videoId');
        const title = tagText(block, 'title');
        const published = tagText(block, 'published');
        if (!videoId || !title || !published) continue;
        const publishedAt = new Date(published);
        if (Number.isNaN(publishedAt.getTime())) continue;
        videos.push({
            videoId,
            title,
            // Tự dựng link từ videoId thay vì tin `<link href>`: link là thứ đi thẳng vào
            // chat, và videoId đã qua kiểm tra dạng ở trên.
            url: `https://www.youtube.com/watch?v=${videoId}`,
            publishedAt,
            thumbnailUrl: attr(block, 'media:thumbnail', 'url')
        });
    }

    // `yt:channelId` ở phần đầu feed KHÔNG có tiền tố "UC" (YouTube bỏ nó), còn trong từng
    // entry thì có. Chuẩn hoá về dạng đầy đủ để so được với ID người dùng đưa.
    const fullId = channelId.startsWith('UC') ? channelId : `UC${channelId}`;
    return { channelId: fullId, channelTitle, videos };
}

export type ChannelInput =
    | { kind: 'id'; id: string }
    | { kind: 'page'; url: string }
    | { kind: 'invalid'; reason: string };

/**
 * Người dùng dán gì vào? Ba dạng nhận được:
 *   - `UC...` (24 ký tự)                      -> dùng ngay
 *   - `@handle` hoặc URL youtube.com/@handle  -> phải fetch trang để lấy ID
 *   - URL youtube.com/channel/UC...           -> lấy ID từ URL, không fetch
 * Mọi thứ khác (link video, host lạ, http trần) bị từ chối với lý do nói được cho người dùng.
 */
export function parseChannelInput(raw: string): ChannelInput {
    const input = raw.trim();
    if (!input) return { kind: 'invalid', reason: 'Chưa nhập gì.' };
    if (YT_CHANNEL_ID.test(input)) return { kind: 'id', id: input };
    if (YT_HANDLE.test(input)) return { kind: 'page', url: `https://www.youtube.com/${input}` };

    let url: URL;
    try {
        url = new URL(input.includes('://') ? input : `https://${input}`);
    } catch {
        return { kind: 'invalid', reason: 'Không đọc được link. Dán `@handle`, ID `UC...`, hoặc link kênh YouTube.' };
    }
    if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
        return { kind: 'invalid', reason: 'Chỉ nhận link trên youtube.com.' };
    }

    const idInPath = /^\/channel\/(UC[\w-]{22})(?:\/|$)/.exec(url.pathname);
    if (idInPath) return { kind: 'id', id: idInPath[1] };

    if (/^\/@[\w.-]{3,30}(?:\/|$)/.test(url.pathname) || /^\/(?:c|user)\/[\w.-]{1,60}(?:\/|$)/.test(url.pathname)) {
        // Bỏ query/hash: `?si=...` của link chia sẻ không có ích, và một URL gọn hơn là một
        // URL khó nhét thứ lạ vào hơn.
        return { kind: 'page', url: `https://www.youtube.com${url.pathname.replace(/\/+$/, '')}` };
    }

    return { kind: 'invalid', reason: 'Đây không phải link kênh. Cần link dạng youtube.com/@handle hoặc youtube.com/channel/UC...' };
}

/**
 * Lấy ID kênh từ HTML trang kênh. YouTube nhúng `"externalId":"UC..."` trong dữ liệu đầu
 * trang; đường lùi là thẻ canonical. Đo thật 6/9/2026: cả hai đều có, handle sai trả 404.
 */
export function extractChannelIdFromHtml(html: string): string | null {
    const external = /"externalId":"(UC[\w-]{22})"/.exec(html);
    if (external) return external[1];
    const canonical = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(html);
    return canonical ? canonical[1] : null;
}

/**
 * Video nào là MỚI so với con trỏ đã lưu, theo thứ tự cũ -> mới để đăng đúng chiều thời gian.
 * Vượt `maxPerTick` thì giữ những video MỚI NHẤT — phần cũ hơn coi như đã qua, không dồn
 * vào chat.
 */
export function pickNewVideos(
    videos: YoutubeVideo[],
    cursor: { lastPublishedAt: Date | null; lastVideoId: string | null },
    maxPerTick: number
): YoutubeVideo[] {
    // Chưa có con trỏ = kênh vừa thêm hoặc dữ liệu cũ: KHÔNG đăng gì, chỉ để tick này đặt mốc.
    if (!cursor.lastPublishedAt) return [];
    const fresh = videos
        .filter(video => video.videoId !== cursor.lastVideoId && video.publishedAt > cursor.lastPublishedAt!)
        .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());
    return fresh.slice(-Math.max(0, maxPerTick));
}

/** Mốc mới nhất trong feed — dùng để đặt con trỏ lúc thêm kênh và sau mỗi lượt đăng. */
export function newestCursor(videos: YoutubeVideo[]): { lastPublishedAt: Date; lastVideoId: string } | null {
    let newest: YoutubeVideo | null = null;
    for (const video of videos) {
        if (!newest || video.publishedAt > newest.publishedAt) newest = video;
    }
    return newest ? { lastPublishedAt: newest.publishedAt, lastVideoId: newest.videoId } : null;
}

export function feedUrlFor(channelId: string): string {
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
}

// ── Hai hàm có mạng ──────────────────────────────────────────────────────────

export async function fetchYoutubeFeed(channelId: string): Promise<YoutubeFeed> {
    if (!YT_CHANNEL_ID.test(channelId)) throw new Error('ID kênh không đúng dạng UC...');
    const response = await fetch(feedUrlFor(channelId), {
        headers: { 'User-Agent': BROWSER_UA },
        signal: AbortSignal.timeout(config.youtube.requestTimeoutMs)
    });
    if (response.status === 404) throw new Error('YouTube không có kênh với ID này.');
    if (!response.ok) throw new Error(`YouTube trả ${response.status}.`);
    const feed = parseYoutubeFeed(await response.text());
    if (!feed) throw new Error('Feed của kênh không đọc được.');
    return feed;
}

/** `@handle` / link kênh -> `UC...`. Chỉ fetch URL đã qua `parseChannelInput` (host đã chốt). */
export async function resolveChannelId(input: string): Promise<string> {
    const parsed = parseChannelInput(input);
    if (parsed.kind === 'invalid') throw new Error(parsed.reason);
    if (parsed.kind === 'id') return parsed.id;

    const response = await fetch(parsed.url, {
        headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en' },
        redirect: 'follow',
        signal: AbortSignal.timeout(config.youtube.requestTimeoutMs)
    });
    if (response.status === 404) throw new Error('Không tìm thấy kênh YouTube này.');
    if (!response.ok) throw new Error(`YouTube trả ${response.status} khi mở trang kênh.`);
    // Redirect có thể đưa ra ngoài youtube.com (consent, region). Trang đó không phải trang
    // kênh, và ta cũng không đọc HTML của host lạ.
    if (!ALLOWED_HOSTS.has(new URL(response.url).hostname.toLowerCase())) {
        throw new Error('YouTube chuyển hướng sang trang lạ, không đọc được kênh.');
    }
    const id = extractChannelIdFromHtml(await response.text());
    if (!id) throw new Error('Mở được trang nhưng không thấy ID kênh — thử dán link dạng youtube.com/channel/UC...');
    return id;
}
