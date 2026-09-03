import { Client, Guild, Sticker } from 'discord.js';

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
//
// Vì sao phải kèm mô tả chứ không chỉ tên: bản đầu chỉ đưa danh sách TÊN. Model
// không nhìn thấy sticker, nên nó chọn theo "vibe" của cái tên — và đoán sai gần
// như mọi lần: sticker mèo khóc thả vào câu chúc mừng, sticker "gg" thả vào câu
// hướng dẫn config. Saly gọi đó là "đính kèm bừa bãi sticker chả liên quan gì".
// Discord có sẵn `description` (admin ghi lúc upload) và `tags` (emoji đại diện,
// bắt buộc khi upload) — đó là hai thứ duy nhất nói sticker này TRÔNG NHƯ THẾ NÀO.
const stickerCache = new Map<string, { text: string; at: number }>();
const MAX_STICKERS = 15;

function describeSticker(sticker: Sticker): string {
    // `tags` là emoji đại diện admin chọn lúc upload (bắt buộc), `description` là
    // chữ mô tả (tuỳ chọn). Ghép cả hai; thiếu cả hai thì đành chỉ có tên.
    const parts = [sticker.description?.trim(), sticker.tags?.trim()].filter(Boolean);
    return parts.length ? `${sticker.name} (${parts.join(' · ')})` : sticker.name;
}

export function buildStickerHint(guild: Guild | null): string {
    if (!guild) return '';

    const hit = stickerCache.get(guild.id);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.text;

    const usable = guild.stickers.cache
        // `available` false = sticker đang bị khoá (server tụt boost): Discord từ
        // chối gửi, nên đừng đưa nó vào danh sách để rồi tin bị lỗi.
        .filter(s => !!s.name && s.available !== false)
        .first(MAX_STICKERS)
        .map(describeSticker);

    if (!usable.length) {
        stickerCache.set(guild.id, { text: '', at: Date.now() });
        return '';
    }

    // Quy tắc mặc định là KHÔNG thả. Bản trước nói "thả khi thật sự vui" — với
    // persona cà khịa thì câu nào cũng "vui", nên nó thả gần như mọi câu. Giờ nêu
    // rõ: chỉ khi nội dung sticker (mô tả trong ngoặc) khớp với cảm xúc của câu
    // trả lời, và không bao giờ ở câu trả lời kỹ thuật.
    const text =
        `STICKER SERVER (tên (mô tả · emoji đại diện)): ${usable.join(', ')}\n` +
        'MẶC ĐỊNH KHÔNG THẢ STICKER. Chỉ thả khi mô tả trong ngoặc khớp ĐÚNG cảm xúc ' +
        'câu trả lời — tên sticker không nói lên nó vẽ gì, phải dựa vào mô tả. Không thả ' +
        'ở câu trả lời kỹ thuật (config, code, hướng dẫn, lỗi). Nếu không chắc sticker nào ' +
        'khớp thì không thả. Khi thả: viết `[[sticker:tên]]` ở CUỐI câu, đúng một cái, ' +
        'đúng tên trong danh sách. Stella tự gắn sticker thật vào.';

    stickerCache.set(guild.id, { text, at: Date.now() });
    return text;
}

// Câu trả lời KỸ THUẬT thì không thả sticker, bất kể model muốn gì.
//
// Prompt đã dặn điều này, nhưng prompt là lời khuyên còn đây là luật: một đoạn
// config YAML dài kèm cái sticker mèo khóc ở dưới đọc như bot bị lỗi. Dấu hiệu
// dùng ở đây rẻ và khó sai: có code block, hoặc câu trả lời dài (hướng dẫn nhiều
// bước). Câu tán gẫu ngắn không bao giờ chạm hai ngưỡng này.
const TECHNICAL_ANSWER_CHARS = 700;

function looksTechnical(text: string): boolean {
    return text.includes('```') || text.length > TECHNICAL_ANSWER_CHARS;
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
    if (looksTechnical(cleaned)) return { text: cleaned };

    const wanted = match[1].trim().toLowerCase();
    // Tra lại `available` lúc gửi chứ không chỉ lúc dựng prompt: prompt được cache
    // 10 phút, server có thể tụt boost trong khoảng đó.
    const found = guild.stickers.cache.find(
        s => s.name?.toLowerCase() === wanted && s.available !== false
    );
    return found ? { text: cleaned, stickerId: found.id } : { text: cleaned };
}

// Tiện cho nơi chỉ có Client (scheduler, bản tin) chứ không có Message.
export function buildEmojiHintFromClient(client: Client): string {
    return buildEmojiHint(client.guilds.cache.first() ?? null);
}
