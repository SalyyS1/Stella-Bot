import { Client } from 'discord.js';
import { config } from '../config';

// Emoji của APP thay vì emoji của một server cụ thể.
//
// Vấn đề đang có: `config.ui.emojis` hard-code 23 emoji dạng `<a:success:149...>`, tất cả
// thuộc MỘT server. Server đó xoá emoji, hoặc bot bị kick khỏi đó, là cả 23 chỗ hiện ra một
// khoảng trắng — và KHÔNG có lỗi nào báo. Discord trả về markup không giải được thì client
// chỉ hiện chữ thô hoặc rỗng; bot không hề biết.
//
// Discord cho mỗi application sở hữu 2000 emoji riêng: chỉ app đó dùng được, không tốn slot
// của server nào, và admin server không xoá được. Đó là chỗ đúng để cất 23 emoji này.
//
// Cách ghép vào code đang chạy: 271 chỗ trong 88 file đọc `config.ui.emojis.<key>`. Sửa hết
// là một diff khổng lồ để đổi đúng một tầng tra cứu. Nên thay vào đó, lúc bot ready ta GHI ĐÈ
// giá trị trong `config.ui.emojis` bằng markup của emoji app cùng tên — mọi chỗ đọc sau đó
// đều nhận emoji app, không sửa một dòng call site nào.
//
// Tên emoji app lấy theo KHOÁ trong config (`success`, `error`, `bump`...), không theo tên
// emoji gốc: khoá là thứ code dùng để tra, nên nó là thứ phải khớp. Vài khoá dùng chung một ID
// (`bump` và `greenArrow`); hai emoji app khác tên trỏ cùng một ảnh là chuyện bình thường.

export interface ParsedEmoji {
    name: string;
    id: string;
    animated: boolean;
}

/** `<a:success:149...>` -> { name, id, animated }. Không khớp thì null. */
export function parseEmojiMarkup(markup: string): ParsedEmoji | null {
    const match = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{15,25})>$/.exec(markup.trim());
    if (!match) return null;
    return { animated: match[1] === 'a', name: match[2], id: match[3] };
}

/**
 * Tên emoji app: 2–32 ký tự, chỉ chữ/số/gạch dưới. Khoá trong config đều hợp lệ, nhưng kiểm
 * ở đây để một khoá mới đặt sai không làm cả lần sync đổ ở giữa.
 */
export function isValidEmojiName(name: string): boolean {
    return /^[A-Za-z0-9_]{2,32}$/.test(name);
}

/** URL ảnh gốc trên CDN. Emoji động là .gif, tĩnh là .png. */
export function cdnUrlFor(emoji: ParsedEmoji): string {
    return `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}`;
}

export interface EmojiPlan {
    /** Khoá trong `config.ui.emojis`, cũng là tên emoji app sẽ tạo. */
    key: string;
    source: ParsedEmoji;
}

/**
 * Những khoá cần tạo emoji app, tính từ config và danh sách tên app đã có.
 *
 * Tách khỏi phần gọi mạng để kiểm được: đây là chỗ dễ sai lặng lẽ nhất (bỏ sót khoá, hoặc tạo
 * lại emoji đã có và ăn rate limit vô ích).
 */
export function planMissingEmojis(existingNames: Iterable<string>): {
    plan: EmojiPlan[];
    unparsable: string[];
    invalidName: string[];
} {
    const have = new Set(existingNames);
    const plan: EmojiPlan[] = [];
    const unparsable: string[] = [];
    const invalidName: string[] = [];

    for (const [key, markup] of Object.entries(config.ui.emojis)) {
        if (!isValidEmojiName(key)) {
            invalidName.push(key);
            continue;
        }
        if (have.has(key)) continue;
        const source = parseEmojiMarkup(String(markup));
        if (!source) {
            // Giá trị không phải markup custom (ai đó đặt emoji unicode) thì không có ảnh nào
            // để tải — bỏ qua, không phải lỗi, nhưng phải nói ra.
            unparsable.push(key);
            continue;
        }
        plan.push({ key, source });
    }

    return { plan, unparsable, invalidName };
}

export interface SyncResult {
    created: string[];
    skipped: string[];
    failed: { key: string; error: string }[];
    unparsable: string[];
    invalidName: string[];
}

/**
 * Tải ảnh 23 emoji từ CDN rồi tạo lại chúng thành emoji của app.
 *
 * CHỈ chạy khi có người gọi tay (`/maintenance sync-emojis`). Không bao giờ chạy lúc boot:
 * đây là ghi ra ngoài, vào tài sản của app, và một lần deploy không nên tự làm chuyện đó.
 *
 * Chỉ chạy được KHI EMOJI GỐC CÒN SỐNG — đó chính là lý do phải làm sớm. Server gốc xoá emoji
 * trước khi sync là mất ảnh, và lúc đó không có gì để cứu ngoài việc tự vẽ lại.
 */
export async function syncApplicationEmojis(client: Client): Promise<SyncResult> {
    if (!client.application) throw new Error('Client chưa ready — chưa có application.');

    const existing = await client.application.emojis.fetch();
    const existingNames = [...existing.values()].map(emoji => emoji.name ?? '');
    const { plan, unparsable, invalidName } = planMissingEmojis(existingNames);

    const result: SyncResult = {
        created: [],
        skipped: existingNames.filter(name => name in config.ui.emojis),
        failed: [],
        unparsable,
        invalidName
    };

    for (const item of plan) {
        try {
            const response = await fetch(cdnUrlFor(item.source));
            if (!response.ok) throw new Error(`CDN trả ${response.status}`);
            const bytes = Buffer.from(await response.arrayBuffer());
            await client.application.emojis.create({ attachment: bytes, name: item.key });
            result.created.push(item.key);
        } catch (error) {
            // Một emoji lỗi không được làm dừng 22 cái còn lại: chạy lại lệnh này là an toàn
            // (đã có thì bỏ qua), nên cứ đi tiếp rồi báo cáo cả danh sách.
            result.failed.push({
                key: item.key,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    return result;
}

/**
 * Ghi đè `config.ui.emojis` bằng emoji app cùng tên. Gọi một lần lúc ready.
 *
 * Ghi ĐÈ TẠI CHỖ (mutate) là có ý: 271 call site đọc `config.ui.emojis.<key>` nên tạo một bản
 * sao mới sẽ không tới được chỗ nào. Khoá nào app không có thì giữ nguyên giá trị cũ — panel
 * emoji của server vẫn là đường lùi, không phải hiện rỗng.
 */
export async function applyApplicationEmojiOverrides(client: Client): Promise<number> {
    if (!client.application) return 0;

    const emojis = await client.application.emojis.fetch();
    const table = config.ui.emojis as Record<string, string>;
    let applied = 0;

    for (const emoji of emojis.values()) {
        const key = emoji.name;
        if (!key || !(key in table)) continue;
        const markup = `<${emoji.animated ? 'a' : ''}:${key}:${emoji.id}>`;
        if (table[key] === markup) continue;
        table[key] = markup;
        applied += 1;
    }

    return applied;
}
