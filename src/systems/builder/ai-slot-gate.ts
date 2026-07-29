// Rate limiting for the expensive AI commands (/config, /plugin).
//
// These get their own gates rather than sharing the Q&A pool because their cost
// profile is different by an order of magnitude: both ask the model to emit a
// whole file, where a chat answer is a paragraph. One shared budget would let a
// few file-sized requests starve ordinary questions.
//
// A factory rather than one module per command: the logic is identical and only
// the limits differ, so duplicating it per feature would mean fixing any bug in
// two places. Limits are read through getters because `config` is a static
// object captured at import time — a getter keeps the numbers editable in one
// place without the gate holding a stale copy.

export type GateReason = 'cooldown' | 'inflight' | 'busy';

export interface GateResult {
    ok: boolean;
    reason?: GateReason;
    retryInSec?: number;
}

export interface SlotGate {
    /** Atomic test-and-reserve. On ok=true the caller MUST release in a finally. */
    reserve(userId: string): GateResult;
    release(userId: string): void;
    message(reason: GateReason, retryInSec?: number): string;
}

export interface SlotGateLimits {
    cooldownMs: () => number;
    maxConcurrent: () => number;
    /** Shown on 'busy' — worded per feature so the user knows what is contended. */
    busyLabel: string;
}

export function createSlotGate(limits: SlotGateLimits): SlotGate {
    const inFlight = new Set<string>();
    const cooldownUntil = new Map<string, number>();
    let activeCount = 0;

    return {
        // Reserve happens in the SAME synchronous call as the check, with no await
        // between: a read-only check followed by an await would let a burst of
        // commands all pass before any of them claimed a slot, which is exactly
        // how a "cap" ends up not capping anything.
        reserve(userId: string): GateResult {
            const now = Date.now();
            const until = cooldownUntil.get(userId) || 0;
            if (until > now) {
                return { ok: false, reason: 'cooldown', retryInSec: Math.ceil((until - now) / 1000) };
            }
            if (inFlight.has(userId)) return { ok: false, reason: 'inflight' };
            if (activeCount >= limits.maxConcurrent()) return { ok: false, reason: 'busy' };

            inFlight.add(userId);
            activeCount++;
            return { ok: true };
        },

        // Must run in a finally by whoever reserved, or the slot leaks for the
        // lifetime of the process. The cooldown starts when the work FINISHES, so
        // a slow request doesn't also get a free fast follow-up.
        release(userId: string): void {
            inFlight.delete(userId);
            activeCount = Math.max(0, activeCount - 1);
            cooldownUntil.set(userId, Date.now() + limits.cooldownMs());
        },

        message(reason: GateReason, retryInSec?: number): string {
            switch (reason) {
                case 'cooldown':
                    return `Hơi nhanh — chờ ${retryInSec ?? 60}s rồi thử lại nhé.`;
                case 'inflight':
                    return 'Bạn đang có một yêu cầu đang xử lý, chờ xong đã.';
                default:
                    return `Stella đang ${limits.busyLabel} cho người khác, thử lại sau vài giây nhé.`;
            }
        }
    };
}
