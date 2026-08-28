import { config } from '../../config';

// Chuyển ngân sách người dùng gõ thành số + đơn vị.
//
// Vì sao cần: cột "budget" cũ là chuỗi tự do nên không sort được, không lọc được tầm giá,
// không thống kê được. Cột mới "budgetAmount" là INTEGER, nhưng người Việt gõ giá theo cả
// chục kiểu: "1M", "1tr5", "500k", "1.500.000", "1,500,000 VND", "$60", "60 usd".
// Parser này nằm ở systems/ để cả handler Discord và route HTTP tương lai dùng cùng một
// cách hiểu, không mỗi nơi tự đoán một kiểu.
//
// Chuỗi gốc VẪN được lưu ở cột "budget" — parser sai hoặc không hiểu thì vẫn còn nguyên
// văn để người đọc tự hiểu, không mất dữ liệu.

export interface ParsedBudget {
    amount: number;
    currency: string;
}

const MAGNITUDES: { token: string; multiplier: number }[] = [
    // Xếp token dài trước token ngắn: "triệu" phải khớp trước "tr", "tr" trước "t".
    { token: 'nghìn', multiplier: 1_000 },
    { token: 'ngàn', multiplier: 1_000 },
    { token: 'triệu', multiplier: 1_000_000 },
    { token: 'trieu', multiplier: 1_000_000 },
    { token: 'tỷ', multiplier: 1_000_000_000 },
    { token: 'ty', multiplier: 1_000_000_000 },
    { token: 'tr', multiplier: 1_000_000 },
    { token: 'k', multiplier: 1_000 },
    { token: 'm', multiplier: 1_000_000 },
    { token: 'b', multiplier: 1_000_000_000 }
];

function currencyRule(code: string) {
    return config.request.currencies.find(c => c.code === code) || null;
}

// Đơn vị: chỉ USD cần nhận dạng, còn lại coi như VND (đây là server Việt).
// Trả về cả chuỗi đã bỏ token đơn vị để bước sau không phải dọn lại.
function extractCurrency(input: string): { currency: string; rest: string } {
    let rest = input;
    let currency = config.request.defaultCurrency;
    if (/\$|usd|dollar/.test(rest)) {
        currency = 'USD';
        rest = rest.replace(/\$|usd|dollars?/g, ' ');
    } else {
        rest = rest.replace(/vnd|vnđ|đồng|dong|đ\b/g, ' ');
    }
    return { currency, rest };
}

function extractMagnitude(input: string): { multiplier: number; rest: string } {
    for (const { token, multiplier } of MAGNITUDES) {
        // Token phải đứng SAU chữ số, nếu không thì "khoảng 1000" có chữ 'k' ở đầu
        // "khoảng" cũng bị tính là nghìn.
        const pattern = new RegExp(`(\\d)\\s*${token}\\b`);
        if (pattern.test(input)) {
            return { multiplier, rest: input.replace(pattern, '$1 ') };
        }
    }
    return { multiplier: 1, rest: input };
}

// "1tr5" / "1m5" — kiểu viết rất phổ biến, nghĩa là 1,5 triệu. Bắt riêng vì nó có chữ số
// SAU token đơn vị, khác mọi trường hợp còn lại.
function expandTrailingHalf(input: string): string {
    return input.replace(/(\d+)\s*(tr|triệu|trieu|m|k)\s*(\d)\b/g, (_all, whole, token, tenths) => `${whole}.${tenths}${token}`);
}

export function parseBudgetInput(raw: string | null | undefined): ParsedBudget | null {
    if (!raw) return null;
    const normalized = expandTrailingHalf(raw.toLowerCase().trim());

    // Khoảng giá ("500k-1tr", "1~2tr", "500k đến 1tr") và số âm đều bị từ chối.
    //
    // Cùng một lý do: bước sau chỉ giữ chữ số, nên "-500k" sẽ thành 500.000 và
    // "500k-1tr" sẽ thành 500.000.001 — hai con số không ai gõ ra và không ai kiểm
    // được. Trả null để người gọi bắt người dùng ghi lại một số cụ thể, còn khoảng
    // giá thì ghi vào phần chi tiết.
    if (normalized.startsWith('-')) return null;
    if (/\d\s*(?:-|–|~|đến|den|to)\s*\d/.test(normalized)) return null;

    const { currency, rest } = extractCurrency(normalized);
    const { multiplier, rest: withoutMagnitude } = extractMagnitude(rest);

    // Hai quy tắc dấu phân cách, phân biệt bằng việc CÓ hay KHÔNG có đơn vị độ lớn:
    //   có  ("1.5tr")      → dấu là dấu thập phân, vì "1.500tr" là vô nghĩa
    //   không ("1.500.000") → dấu là phân cách nghìn
    const digitsOnly = multiplier > 1
        ? withoutMagnitude.replace(/,/g, '.').replace(/[^\d.]/g, '')
        : withoutMagnitude.replace(/[^\d]/g, '');
    if (!digitsOnly) return null;

    const amount = Math.round(Number(digitsOnly) * multiplier);
    if (!Number.isFinite(amount) || amount <= 0) return null;

    const rule = currencyRule(currency);
    if (!rule || amount > rule.max) return null;
    return { amount, currency };
}

export function formatBudget(amount: number | null, currency: string | null, fallback: string | null): string {
    if (amount === null || amount === undefined) return fallback?.trim() || 'Chưa ghi';
    const code = currency || config.request.defaultCurrency;
    return `${amount.toLocaleString('vi-VN')} ${code}`;
}

// Câu gợi ý hiển thị dưới ô nhập giá, dựng từ config để trần trong hướng dẫn không bao giờ
// lệch với trần thật khi ai đó sửa config.
export function budgetHintText(): string {
    const parts = config.request.currencies.map(c => `${c.code} tối đa ${c.max.toLocaleString('vi-VN')}`);
    return `Ví dụ: 500k · 1tr5 · 1.500.000 · 60 USD (${parts.join(', ')})`;
}
