import { Client } from 'discord.js';
import { config } from '../config';
import { postTrivia, expireTrivia, hasActiveTrivia } from './trivia-manager';

// Drives auto-trivia timing. A ~30-min tick: every tick expires a stale open
// question, and — when inside active hours and no question is open — posts a new
// one with a probability tuned so the daily count lands in [perDayMin, perDayMax].
// No persisted schedule: the randomness self-spreads posts across the day, and a
// restart just resumes ticking (losing at most the in-flight question).

const TICK_MS = 30 * 60_000;
let interval: NodeJS.Timeout | null = null;
let busy = false;

// True when the current local (Asia/Saigon) hour is OUTSIDE the quiet window.
// Quiet window wraps midnight (e.g. 1h..8h), so handle the wrap explicitly.
function isActiveHour(now = new Date()): boolean {
    const h = now.getHours();
    const { quietStartHour, quietEndHour } = config.trivia;
    // Quiet = [quietStartHour, quietEndHour). Active = the complement.
    if (quietStartHour < quietEndHour) {
        return h < quietStartHour || h >= quietEndHour;
    }
    // Wrapped quiet window (start > end) — quiet spans midnight.
    return h >= quietEndHour && h < quietStartHour;
}

// Number of ticks in one active-hours span per day, used to convert the desired
// posts/day into a per-tick probability.
function activeTicksPerDay(): number {
    const { quietStartHour, quietEndHour } = config.trivia;
    const quietHours = quietStartHour < quietEndHour
        ? quietEndHour - quietStartHour
        : 24 - (quietStartHour - quietEndHour);
    const activeHours = 24 - quietHours;
    return Math.max(1, (activeHours * 60_000 * 60) / TICK_MS);
}

function postProbabilityPerTick(): number {
    const target = (config.trivia.perDayMin + config.trivia.perDayMax) / 2;
    return Math.min(1, target / activeTicksPerDay());
}

export function startTriviaScheduler(client: Client): void {
    if (interval) clearInterval(interval);
    interval = setInterval(async () => {
        if (busy) return;
        busy = true;
        try {
            await expireTrivia(client);
            if (!hasActiveTrivia() && isActiveHour() && Math.random() < postProbabilityPerTick()) {
                await postTrivia(client);
            }
        } catch (error) {
            console.error('Trivia scheduler tick failed:', error);
        } finally {
            busy = false;
        }
    }, TICK_MS);
}
