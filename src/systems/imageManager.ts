import { config } from '../config';
import { generateImage, isImageEnabled, GeneratedImage } from './geminiImageClient';

// Community-facing AI image generation. Owns the spam/cost controls (per-user
// cooldown, per-user single-in-flight, global concurrency cap) and delegates the
// actual generation to the Gemini client. Mirrors aiQaManager's gate model
// because image gen is slower and pricier than a text reply — same real caps.

const inFlight = new Set<string>();        // userIds with a request currently processing
const cooldownUntil = new Map<string, number>(); // userId -> timestamp
let activeCount = 0;                        // global concurrent image jobs

export interface ImageGateResult {
    ok: boolean;
    reason?: 'cooldown' | 'inflight' | 'busy' | 'disabled';
}

// Atomic test-AND-reserve: checks the gates and, if clear, immediately claims the
// slot (inFlight + activeCount) in the SAME synchronous call — no await in between.
// On ok=true the caller MUST call runImage (which releases in its finally). On
// ok=false nothing is held. Same race-safety contract as reserveQaSlot.
export function reserveImageSlot(userId: string): ImageGateResult {
    if (!isImageEnabled()) return { ok: false, reason: 'disabled' };
    const now = Date.now();
    const until = cooldownUntil.get(userId) || 0;
    if (until > now) return { ok: false, reason: 'cooldown' };
    if (inFlight.has(userId)) return { ok: false, reason: 'inflight' };
    if (activeCount >= config.ai.image.maxConcurrent) return { ok: false, reason: 'busy' };
    inFlight.add(userId);
    activeCount++;
    return { ok: true };
}

export function imageGateMessage(reason: ImageGateResult['reason']): string {
    switch (reason) {
        case 'cooldown': return `${config.ui.emojis.error} Vẽ hơi nhanh — chờ chút cho Stella nghỉ tay rồi thử lại nhé.`;
        case 'inflight': return `${config.ui.emojis.error} Bạn đang có 1 ảnh đang vẽ, chờ Stella xong đã.`;
        case 'busy': return `${config.ui.emojis.error} Stella đang vẽ cho người khác, thử lại sau chút nhé.`;
        default: return `${config.ui.emojis.error} Tính năng tạo ảnh đang tắt.`;
    }
}

// Run generation, then release the slot and set the cooldown. Caller must have
// passed reserveImageSlot first (slot already reserved). Returns the image bytes
// or null on any failure — the cooldown is set either way so a failed prompt
// can't be hammered.
export async function runImage(userId: string, prompt: string): Promise<GeneratedImage | null> {
    try {
        return await generateImage(prompt.slice(0, config.ai.image.maxPromptLen));
    } finally {
        inFlight.delete(userId);
        activeCount = Math.max(0, activeCount - 1);
        cooldownUntil.set(userId, Date.now() + config.ai.image.cooldownMs);
    }
}
