import { config } from '../config';
import prisma from '../lib/prisma';
import { askAI } from './aiClient';

// Long-term member memory. Distinct from the short-term conversation history in
// aiQaManager (RAM, 6 turns): these are durable one-line "facts" a member said
// PUBLICLY (e.g. "thích xây nhà gỗ") that Stella can reuse to personalize/tease.
// This is the highest-risk feature — so it is fail-closed (off unless the env
// flag is set), has a hard forbidden-topics filter in the extraction prompt, and
// exposes a self-service forget command. Facts are capped per user; the oldest is
// dropped when the cap is exceeded.

// Extraction prompt: pull at most ONE short, SAFE fact, or return exactly NONE.
// The forbidden list is the privacy brake — romance/drama/sensitive identity must
// never become a stored fact, because Stella will later surface it to tease.
const EXTRACT_PROMPT =
    'Bạn là bộ lọc trí nhớ cho trợ lý cộng đồng. Từ đoạn chat CÔNG KHAI dưới đây, rút ĐÚNG 1 điều ngắn gọn, vui, AN TOÀN đáng nhớ về người nói (sở thích, thói quen chơi game, việc họ hay làm trong server…). ' +
    'TUYỆT ĐỐI KHÔNG rút và trả về NONE nếu nội dung dính bất kỳ điều nào sau: chuyện tình cảm/thích ai/người yêu, drama/xích mích/mâu thuẫn, thông tin nhạy cảm (tuổi thật, tên thật, địa chỉ, trường/lớp, số điện thoại, nơi ở), phốt/bóc phốt, chuyện gia đình/người đã mất, sức khoẻ, tôn giáo/chính trị, hay bất cứ gì có thể khiến người đó xấu hổ nếu bị nhắc lại. ' +
    'Nếu không có gì đáng nhớ VÀ an toàn → trả về đúng một từ: NONE. ' +
    'Nếu có → trả về DUY NHẤT câu fact ngắn (tối đa 1 câu, tiếng Việt, không giải thích, không tiền tố), viết ở ngôi thứ ba (vd: "Thích xây nhà gỗ", "Hay hỏi về plugin MythicMobs").';

export function isMemoryEnabled(): boolean {
    return config.memory.enabled;
}

// Extract a safe fact from a completed public exchange and store it. Fail-closed:
// disabled unless the flag is on. Runs in the background from the caller (never
// blocks the reply). Silently no-ops on NONE, invalid length, or any AI failure.
export async function extractFact(userId: string, question: string, answer: string): Promise<void> {
    if (!config.memory.enabled) return;
    const raw = await askAI(
        [
            { role: 'system', content: EXTRACT_PROMPT },
            { role: 'user', content: `Người nói: "${question.slice(0, 500)}"\nStella đáp: "${answer.slice(0, 500)}"` }
        ],
        { maxTokens: 60, temperature: 0.2 }
    ).catch(() => null);

    if (!raw) return;
    const fact = raw.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
    if (!fact || fact.toUpperCase() === 'NONE') return;
    if (fact.length < config.memory.minChars || fact.length > config.memory.maxChars) return;

    try {
        // Upsert-by-content: @@unique([userId, fact]) makes a repeat fact a no-op
        // update instead of a duplicate row.
        await prisma.memberFact.upsert({
            where: { userId_fact: { userId, fact } },
            update: {},
            create: { userId, fact }
        });
        // Enforce the per-user cap: drop the oldest rows beyond the limit.
        const facts = await prisma.memberFact.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            select: { id: true }
        });
        if (facts.length > config.memory.maxFactsPerUser) {
            const stale = facts.slice(config.memory.maxFactsPerUser).map(f => f.id);
            await prisma.memberFact.deleteMany({ where: { id: { in: stale } } });
        }
    } catch (error) {
        console.error('[memberMemory] store fact failed:', error);
    }
}

// Read a user's stored facts (newest first) for injecting into Q&A context.
export async function getFacts(userId: string): Promise<string[]> {
    if (!config.memory.enabled) return [];
    const rows = await prisma.memberFact.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: config.memory.maxFactsPerUser,
        select: { fact: true }
    }).catch(() => []);
    return rows.map(r => r.fact);
}

// Wipe every fact stored about a user (the /stella quên-tôi command). Returns the
// number of facts removed so the caller can confirm.
export async function forgetUser(userId: string): Promise<number> {
    const result = await prisma.memberFact.deleteMany({ where: { userId } });
    return result.count;
}
