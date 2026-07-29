import { config } from '../../config';

// Extracts "words Stella didn't understand" out of a chunk summary.
//
// Deliberately NOT a separate AI call. The chunk summarizer already reads every
// message of a 3h window, so it is asked to append a small marker line listing
// unfamiliar jargon; this module only parses that line back out. Adding a second
// pass would multiply the feature's cost by the number of slots per day for
// information the first pass already had in front of it.
//
// The marker is a single line so a summary that lacks it (older rows, a model
// that ignored the instruction) parses to an empty list instead of failing.

export const TERM_MARKER = 'TU_LA:';

// Appended to the chunk system prompt. Kept here, next to the parser, so the
// instruction and the thing that reads it can never drift apart.
export const TERM_INSTRUCTION =
    `Cuối cùng, thêm ĐÚNG MỘT dòng riêng bắt đầu bằng "${TERM_MARKER}" liệt kê các ` +
    'thuật ngữ/tên riêng/tiếng lóng xuất hiện trong chat mà bạn KHÔNG chắc nghĩa ' +
    '(cách nhau bằng dấu phẩy, tối đa 5 từ, mỗi từ ngắn gọn). Nếu bạn hiểu hết thì ' +
    `ghi "${TERM_MARKER} không có". Dòng này là dữ liệu nội bộ, không phải nội dung bản tin.`;

// Words that are never worth asking about: Stella's own vocabulary, Discord/
// Minecraft basics, and the filler the model tends to emit when it has nothing.
const IGNORED = new Set([
    'không có', 'khong co', 'none', 'n/a', 'không', 'khong',
    'stella', 'discord', 'minecraft', 'server', 'plugin', 'config',
    'scoin', 'showcase', 'request', 'bot', 'admin', 'mod'
]);

// Pull the marker line out of a chunk summary and return it as a clean term list.
// Returns the summary with that line removed, so the marker never reaches the
// daily bulletin prompt as if it were content.
export function extractTerms(summary: string): { summary: string; terms: string[] } {
    const lines = summary.split(/\r?\n/);
    const kept: string[] = [];
    const terms: string[] = [];

    for (const line of lines) {
        const trimmed = line.trim();
        // Tolerate the model bolding the marker or prefixing it with a bullet.
        const marker = trimmed.replace(/^[-*\s]+/, '').replace(/\*\*/g, '');
        if (!marker.toUpperCase().startsWith(TERM_MARKER)) {
            kept.push(line);
            continue;
        }
        const payload = marker.slice(TERM_MARKER.length);
        for (const raw of payload.split(/[,;]/)) {
            const term = raw.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
            if (!term) continue;
            if (IGNORED.has(term.toLowerCase())) continue;
            terms.push(term);
        }
    }

    return {
        summary: kept.join('\n').trim(),
        terms: terms.slice(0, config.knowledge.maxTermsPerAsk)
    };
}
