// Trạng thái ngắn hạn theo người: spam nhiều tin liên tục (flood) và gửi lại y nguyên
// một nội dung (duplicate).
//
// Vì sao giữ trong RAM chứ không ghi DB: hai luật này chạy trên MỌI tin nhắn của server.
// Một round-trip Postgres cho mỗi tin là cái giá không đáng cho việc đếm 6 tin/5 giây, và
// mất dữ liệu khi restart không gây hại gì — cửa sổ đếm chỉ dài vài giây.
//
// `now` là tham số chứ không gọi Date.now() bên trong để test kiểm được ranh giới cửa sổ
// thời gian mà không phải chờ thật.

export interface FloodParams {
    enabled?: boolean;
    messages?: number;
    windowMs?: number;
}

export interface DuplicateParams {
    enabled?: boolean;
    times?: number;
    windowMs?: number;
}

interface UserWindow {
    /** Mốc thời gian các tin gần đây, dùng cho flood. */
    stamps: number[];
    /** Nội dung đã chuẩn hoá của lần gửi gần nhất + số lần lặp liền nhau. */
    lastContent: string;
    repeats: number;
    lastRepeatAt: number;
}

const windows = new Map<string, UserWindow>();
// Dọn định kỳ: một server đông người sẽ tích hàng nghìn key, mà phần lớn là người đã
// ngừng chat từ lâu.
const IDLE_TTL_MS = 10 * 60_000;
let lastSweepAt = 0;

function sweep(now: number): void {
    if (now - lastSweepAt < 60_000) return;
    lastSweepAt = now;
    for (const [key, window] of windows) {
        const newest = Math.max(window.stamps[window.stamps.length - 1] ?? 0, window.lastRepeatAt);
        if (now - newest > IDLE_TTL_MS) windows.delete(key);
    }
}

/** Chuẩn hoá để "hi", "HI  " và "hi" tính là cùng một nội dung. */
function normalize(content: string): string {
    return content.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface RateHit {
    rule: 'flood' | 'duplicate';
    detail: string;
}

/**
 * Ghi nhận một tin nhắn và cho biết nó có chạm luật flood/duplicate không.
 *
 * Sau khi trả về vi phạm, bộ đếm tương ứng được RESET. Nếu không reset thì mỗi tin tiếp
 * theo trong cùng đợt spam lại là một vi phạm mới, và người dùng ăn 10 strike cho một
 * lần gõ nhanh — ngưỡng leo thang mất hết ý nghĩa.
 */
export function trackMessage(
    userId: string,
    content: string,
    now: number,
    flood: FloodParams | undefined,
    duplicate: DuplicateParams | undefined
): RateHit | null {
    sweep(now);

    const window = windows.get(userId) ?? { stamps: [], lastContent: '', repeats: 0, lastRepeatAt: 0 };
    windows.set(userId, window);

    if (flood?.enabled) {
        const windowMs = flood.windowMs ?? 5_000;
        window.stamps = window.stamps.filter(stamp => now - stamp < windowMs);
        window.stamps.push(now);
        if (window.stamps.length >= (flood.messages ?? 6)) {
            const count = window.stamps.length;
            window.stamps = [];
            return { rule: 'flood', detail: `${count} tin trong ${Math.round(windowMs / 1000)}s` };
        }
    }

    if (duplicate?.enabled) {
        const normalized = normalize(content);
        const windowMs = duplicate.windowMs ?? 30_000;
        // Nội dung rỗng (chỉ ảnh/sticker) không tính trùng lặp: gửi 3 ảnh liền nhau là
        // hành vi bình thường ở kênh share.
        if (normalized) {
            const withinWindow = now - window.lastRepeatAt < windowMs;
            if (normalized === window.lastContent && withinWindow) {
                window.repeats += 1;
            } else {
                window.lastContent = normalized;
                window.repeats = 1;
            }
            window.lastRepeatAt = now;
            if (window.repeats >= (duplicate.times ?? 3)) {
                const times = window.repeats;
                window.repeats = 0;
                window.lastContent = '';
                return { rule: 'duplicate', detail: `Gửi lại cùng một nội dung ${times} lần` };
            }
        }
    }

    return null;
}

/** Xoá trạng thái của một người — dùng khi mod đã xử lý hoặc khi tắt automod. */
export function resetTracker(userId?: string): void {
    if (userId) windows.delete(userId);
    else windows.clear();
}
