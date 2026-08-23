import { AttachmentBuilder, Client } from 'discord.js';
import { config } from '../../config';

// ============================================================
//  MUSIC PLAYLIST COVER — anh bia do nguoi dung tu dat
// ============================================================
// Hai duong vao: dan link https, hoac upload file. File upload phai duoc
// re-upload sang asset channel roi luu MESSAGE ID, khong luu URL attachment goc:
// URL attachment cua Discord bay gio co signature het han (?ex=&is=&hm=), luu
// thang URL la vai ngay sau anh bia chet.

const LIMITS = config.music.playlist;
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
/** URL attachment co signature song lau hon nhieu, cache 1h la du an toan. */
const COVER_URL_TTL_MS = 60 * 60_000;

const coverUrlCache = new Map<string, { url: string; expiresAt: number }>();

export function assetChannelId() {
    return (process.env.MUSIC_ASSET_CHANNEL_ID || '').trim();
}

/**
 * Chi nhan link https tro tiep tới file anh. CO Y khong fetch link nay o server
 * de kiem tra (tranh SSRF): de Discord tu proxy, hong thi embed chi mat anh.
 */
export function validateCoverUrl(raw: string) {
    const value = (raw || '').trim();
    if (!value) throw new Error('Link ảnh trống.');
    if (value.length > LIMITS.coverUrlMaxLength) throw new Error(`Link ảnh tối đa ${LIMITS.coverUrlMaxLength} ký tự.`);

    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        throw new Error('Link ảnh không hợp lệ.');
    }
    if (parsed.protocol !== 'https:') throw new Error('Link ảnh phải là https.');

    const path = parsed.pathname.toLowerCase();
    if (!IMAGE_EXTENSIONS.some(ext => path.endsWith(ext))) {
        throw new Error(`Link phải trỏ tới file ảnh (${IMAGE_EXTENSIONS.join(', ')}).`);
    }
    return value;
}

/** Tai file nguoi dung upload roi dang lai vao asset channel, tra ve message id. */
export async function storeCoverAttachment(client: Client, attachment: { url: string; contentType: string | null; size: number; name: string }) {
    const channelId = assetChannelId();
    if (!channelId) {
        throw new Error('Chưa cấu hình `MUSIC_ASSET_CHANNEL_ID` nên chưa nhận được ảnh upload. Dùng option `url` để dán link ảnh nhé.');
    }
    if (!attachment.contentType || !attachment.contentType.startsWith('image/')) throw new Error('File đính kèm phải là ảnh.');
    if (attachment.size > LIMITS.coverMaxBytes) throw new Error(`Ảnh tối đa ${Math.floor(LIMITS.coverMaxBytes / 1024 / 1024)}MB.`);

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) throw new Error('`MUSIC_ASSET_CHANNEL_ID` không trỏ tới text channel mà bot đọc được.');

    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error('Không tải được ảnh vừa upload, thử lại nhé.');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > LIMITS.coverMaxBytes) throw new Error('Ảnh vượt quá giới hạn dung lượng.');

    const safeName = /\.(png|jpe?g|gif|webp)$/i.test(attachment.name) ? attachment.name : 'cover.png';
    const message = await (channel as any).send({
        content: 'Ảnh bìa playlist',
        files: [new AttachmentBuilder(buffer, { name: safeName })]
    });
    return message.id as string;
}

/** URL ảnh để render embed: message id thì fetch URL tươi, còn lại dùng coverUrl. */
export async function resolveCoverImageUrl(client: Client, playlist: { coverUrl: string | null; coverMessageId: string | null }) {
    if (!playlist.coverMessageId) return playlist.coverUrl || null;

    const cached = coverUrlCache.get(playlist.coverMessageId);
    if (cached && cached.expiresAt > Date.now()) return cached.url;

    const channelId = assetChannelId();
    if (!channelId) return playlist.coverUrl || null;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return playlist.coverUrl || null;

    const message = await (channel as any).messages?.fetch(playlist.coverMessageId).catch(() => null);
    const url = message?.attachments?.first()?.url;
    if (!url) return playlist.coverUrl || null;

    coverUrlCache.set(playlist.coverMessageId, { url, expiresAt: Date.now() + COVER_URL_TTL_MS });
    return url as string;
}
