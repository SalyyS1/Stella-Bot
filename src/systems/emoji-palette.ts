import { Client, Guild } from 'discord.js';

// Danh sách emoji THẬT của server, để Stella thả emoji cho vui mà không bị hiện
// ra chữ lỗi.
//
// Vì sao cần cả một module cho việc này: emoji riêng của server phải viết đúng
// dạng `<:tên:id>` với id thật. Model không biết id nào tồn tại, nên nếu chỉ dặn
// "hãy dùng emoji server" thì nó sẽ tự bịa một dãy số — và Discord hiển thị đúng
// cái chuỗi `<:kek:12345>` đó ra giữa câu, trông như bot bị lỗi. Đưa sẵn danh
// sách thật là cách duy nhất để nó dùng được.
//
// Emoji Unicode (😂🔥) thì luôn an toàn, không cần danh sách.

// Trần số emoji bơm vào prompt. Server có thể có hàng trăm; nhồi hết vào là lấy
// chỗ của chính câu hỏi trong cửa sổ context, mà model cũng không dùng nổi quá
// vài cái trong một câu trả lời.
const MAX_EMOJIS = 40;

// Cache theo guild: danh sách emoji đổi rất ít, còn tính năng này chạy trên MỌI
// tin nhắn `!s`. Đọc cache của discord.js thì rẻ, nhưng dựng lại chuỗi mỗi lần
// thì không cần thiết.
const cache = new Map<string, { text: string; at: number }>();
const CACHE_TTL_MS = 10 * 60_000;

// Emoji động (animated) phải mang tiền tố `a:`, thiếu nó là hiện ra chữ lỗi —
// đúng loại sai khó thấy khi đọc code mà rất rõ khi nhìn tin nhắn.
function render(name: string, id: string, animated: boolean): string {
    return animated ? `<a:${name}:${id}>` : `<:${name}:${id}>`;
}

export function buildEmojiHint(guild: Guild | null): string {
    if (!guild) return '';

    const hit = cache.get(guild.id);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.text;

    const usable = guild.emojis.cache
        // `available` false = emoji đang bị khoá (server tụt boost). Gửi nó ra thì
        // Discord không render, nên lọc ở đây thay vì để người dùng thấy chữ lỗi.
        .filter(e => e.available !== false && !!e.name)
        .first(MAX_EMOJIS)
        .map(e => render(e.name!, e.id, e.animated ?? false));

    if (!usable.length) {
        cache.set(guild.id, { text: '', at: Date.now() });
        return '';
    }

    const text =
        'EMOJI SERVER (dùng được, copy y hệt cả chuỗi kể cả dấu <>): ' +
        usable.join(' ') + '\n' +
        'Chỉ dùng ĐÚNG những chuỗi trong danh sách trên. TUYỆT ĐỐI không tự nghĩ ra ' +
        'id emoji khác — id sai thì Discord hiện nguyên đoạn `<:abc:123>` ra giữa câu, ' +
        'trông như bot bị lỗi.';

    cache.set(guild.id, { text, at: Date.now() });
    return text;
}

// Xoá cache khi admin thêm/xoá emoji, để Stella không dùng mãi một emoji đã bị xoá.
export function invalidateEmojiHint(guildId: string): void {
    cache.delete(guildId);
    stickerCache.delete(guildId);
}

// ── Sticker ──────────────────────────────────────────────────────────────────
//
// Sticker KHÔNG gửi được bằng cách viết chuỗi vào nội dung tin nhắn — nó là một
// field riêng trong payload (`stickers: [id]`). Nên dù có dặn cách nào, model
// cũng không thể tự thả sticker; nó chỉ có thể NÓI TÊN sticker muốn thả.
//
// Vì vậy quy ước: model viết `[[sticker:tên]]` ở cuối câu, code tra tên đó ra id
// thật rồi gửi kèm. Code giữ quyền quyết định — tên không có trong server thì
// marker bị xoá và tin vẫn gửi bình thường, thay vì hiện ra một đoạn rác.
const stickerCache = new Map<string, { names: string[]; at: number }>();
const MAX_STICKERS = 15;

function stickerNames(guild: Guild): string[] {
    const hit = stickerCache.get(guild.id);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.names;
    const names = guild.stickers.cache
        .filter(s => !!s.name)
        .first(MAX_STICKERS)
        .map(s => s.name);
    stickerCache.set(guild.id, { names, at: Date.now() });
    return names;
}

export function buildStickerHint(guild: Guild | null): string {
    if (!guild) return '';
    const names = stickerNames(guild);
    if (!names.length) return '';
    return (
        `STICKER SERVER: ${names.join(', ')}\n` +
        'Muốn thả sticker thì viết `[[sticker:tên]]` ở CUỐI câu trả lời, đúng một cái, ' +
        'và chỉ dùng tên có trong danh sách trên. Stella sẽ tự gắn sticker thật vào — ' +
        'đừng viết gì khác ngoài dạng đó. Thả sticker khi thật sự vui/đúng lúc thôi, ' +
        'không phải câu nào cũng thả.'
    );
}

// Tách marker khỏi nội dung và trả về id sticker thật (nếu tên có thật).
//
// Luôn xoá marker khỏi text, kể cả khi không tra được tên: để lại thì người dùng
// đọc thấy `[[sticker:kek]]` giữa câu — tệ hơn hẳn so với việc thiếu một sticker.
export function extractSticker(
    text: string,
    guild: Guild | null
): { text: string; stickerId?: string } {
    const match = text.match(/\[\[sticker:([^\]]{1,60})\]\]/i);
    if (!match) return { text };

    const cleaned = text.replace(match[0], '').trimEnd();
    if (!guild) return { text: cleaned };

    const wanted = match[1].trim().toLowerCase();
    const found = guild.stickers.cache.find(s => s.name?.toLowerCase() === wanted);
    return found ? { text: cleaned, stickerId: found.id } : { text: cleaned };
}

// Tiện cho nơi chỉ có Client (scheduler, bản tin) chứ không có Message.
export function buildEmojiHintFromClient(client: Client): string {
    return buildEmojiHint(client.guilds.cache.first() ?? null);
}
