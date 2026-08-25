// Đọc thời lượng dạng người viết: "10m", "2h", "3d", "1h30m", "90s".
//
// Vì sao tự viết: chỉ có bốn đơn vị và bot cần thông báo lỗi bằng tiếng Việt đúng
// ngữ cảnh ("timeout tối đa 28 ngày" khác "giveaway tối đa 365 ngày"), nên một thư
// viện parse thời gian tổng quát vừa nặng hơn vừa nói tiếng Anh.

const UNIT_MS: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000
};

export interface ParseDurationOptions {
    /** Trần cho phép, tính bằng ms. */
    maxMs: number;
    /** Sàn cho phép, tính bằng ms. Mặc định 1 giây. */
    minMs?: number;
    /** Tên trần để đưa vào thông báo lỗi, ví dụ "28 ngày". */
    maxLabel: string;
}

export function parseDurationMs(input: string, options: ParseDurationOptions): number {
    const cleaned = input.trim().toLowerCase().replace(/\s+/g, '');
    if (!cleaned) throw new Error('Thiếu thời lượng. Ví dụ: `10m`, `2h`, `3d`, `1h30m`.');

    const matches = [...cleaned.matchAll(/(\d+)([smhd])/g)];
    // Chuỗi phải được tiêu thụ HẾT bởi các cặp số+đơn vị. Nếu không kiểm, "10x" sẽ
    // parse thành 0 và người dùng nhận một hình phạt dài 0 giây mà không hiểu vì sao.
    const consumed = matches.reduce((sum, match) => sum + match[0].length, 0);
    if (!matches.length || consumed !== cleaned.length) {
        throw new Error('Thời lượng không hợp lệ. Dùng dạng `30s`, `10m`, `2h`, `3d` hoặc `1h30m`.');
    }

    let total = 0;
    for (const match of matches) {
        const amount = Number(match[1]);
        if (!Number.isSafeInteger(amount)) throw new Error('Thời lượng quá lớn.');
        total += amount * UNIT_MS[match[2]];
    }

    const minMs = options.minMs ?? 1_000;
    if (total < minMs) throw new Error(`Thời lượng tối thiểu là ${Math.round(minMs / 1_000)} giây.`);
    if (total > options.maxMs) throw new Error(`Thời lượng tối đa là ${options.maxLabel}.`);
    return total;
}

export function formatDuration(ms: number): string {
    const days = Math.floor(ms / UNIT_MS.d);
    const hours = Math.floor((ms % UNIT_MS.d) / UNIT_MS.h);
    const minutes = Math.floor((ms % UNIT_MS.h) / UNIT_MS.m);
    const seconds = Math.floor((ms % UNIT_MS.m) / UNIT_MS.s);
    const parts = [
        days ? `${days} ngày` : null,
        hours ? `${hours} giờ` : null,
        minutes ? `${minutes} phút` : null,
        seconds && !days && !hours ? `${seconds} giây` : null
    ].filter(Boolean);
    return parts.join(' ') || '0 giây';
}
