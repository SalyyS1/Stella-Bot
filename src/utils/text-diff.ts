// So sánh hai đoạn văn theo TỪ để chỉ ra đúng chỗ đã sửa.
//
// Vì sao theo từ chứ không theo ký tự: một tin nhắn bị sửa một chữ, diff theo ký tự
// sẽ tô lẻ tẻ từng chữ cái giữa các từ và người đọc phải tự ghép lại. Theo từ thì
// đọc là thấy.
//
// Vì sao tự viết chứ không thêm thư viện: thuật toán LCS cho một tin nhắn Discord
// (≤ 4000 ký tự) là vài chục dòng, còn thêm một dependency vào bot đang chạy production
// thì phải nuôi nó mãi.

export type DiffType = 'same' | 'add' | 'del';

export interface DiffSegment {
    type: DiffType;
    text: string;
}

// Trần số token cho bảng LCS. 400×400 = 160k ô là còn nhanh; vượt thì so cả khối,
// vì một tin bị sửa gần như toàn bộ thì diff chi tiết cũng không ai đọc.
const MAX_TOKENS = 400;

function tokenize(text: string): string[] {
    return text.split(/(\s+)/).filter(token => token.length > 0);
}

export function diffWords(before: string, after: string): DiffSegment[] {
    const a = tokenize(before);
    const b = tokenize(after);

    if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
        const segments: DiffSegment[] = [];
        if (before) segments.push({ type: 'del', text: before });
        if (after) segments.push({ type: 'add', text: after });
        return segments;
    }

    // lcs[i][j] = độ dài dãy con chung dài nhất của a[i..] và b[j..]
    const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            lcs[i][j] = a[i] === b[j]
                ? lcs[i + 1][j + 1] + 1
                : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
        }
    }

    const raw: DiffSegment[] = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) {
            raw.push({ type: 'same', text: a[i] });
            i++;
            j++;
        } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
            raw.push({ type: 'del', text: a[i] });
            i++;
        } else {
            raw.push({ type: 'add', text: b[j] });
            j++;
        }
    }
    while (i < a.length) raw.push({ type: 'del', text: a[i++] });
    while (j < b.length) raw.push({ type: 'add', text: b[j++] });

    // Gộp các token liền nhau cùng loại để không sinh hàng trăm mảnh một chữ.
    const merged: DiffSegment[] = [];
    for (const segment of raw) {
        const last = merged[merged.length - 1];
        if (last && last.type === segment.type) last.text += segment.text;
        else merged.push({ ...segment });
    }
    return merged;
}

function clip(text: string, limit: number): string {
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

// Bản gộp: giữ nguyên phần không đổi, gạch ngang phần bị xoá, in đậm phần thêm vào.
// Đọc một lượt là thấy câu trước và câu sau cùng lúc.
export function renderInlineDiff(before: string, after: string, limit = 1800): string {
    const segments = diffWords(before, after);
    const rendered = segments.map(segment => {
        if (segment.type === 'same') return segment.text;
        const trimmed = segment.text.trim();
        if (!trimmed) return segment.text;
        const spacer = segment.text.startsWith(' ') ? ' ' : '';
        return segment.type === 'del' ? `${spacer}~~${trimmed}~~` : `${spacer}**${trimmed}**`;
    }).join('');
    return clip(rendered, limit) || '*(không có nội dung văn bản)*';
}

// Bản khối code kiểu `diff` — Discord tự tô đỏ dòng `-` và xanh dòng `+`.
export function renderDiffCodeBlock(before: string, after: string, limit = 1600): string {
    const segments = diffWords(before, after);
    const removed = segments.filter(s => s.type === 'del').map(s => s.text.trim()).filter(Boolean);
    const added = segments.filter(s => s.type === 'add').map(s => s.text.trim()).filter(Boolean);

    if (!removed.length && !added.length) return '```\nKhông có thay đổi trong phần văn bản.\n```';

    const lines: string[] = [];
    if (removed.length) lines.push(`- ${clip(removed.join(' … '), limit / 2)}`);
    if (added.length) lines.push(`+ ${clip(added.join(' … '), limit / 2)}`);
    return `\`\`\`diff\n${lines.join('\n')}\n\`\`\``;
}
