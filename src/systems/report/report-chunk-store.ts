import prisma from '../../lib/prisma';
import { periodDaysAgo } from './report-time-window';
import { config } from '../../config';

// Persistence for the intermediate 3h summaries. Rows live in Postgres rather
// than a temp file: the bot runs on shared hosting where the filesystem may not
// survive a restart, and losing chunks mid-day would silently degrade the daily
// report back to the thin thing it was before.

export interface StoredChunk {
    slot: number;
    summary: string;
    msgCount: number;
}

// Record the outcome of a slot. An empty window is stored too (summary '',
// msgCount 0): the row is the proof we already looked, so the scheduler stops
// re-collecting a quiet night on every tick instead of retrying it forever.
//
// upsert, not create: the MaintenanceLog claim already makes a double-run
// unlikely, but if a claim is released after a failed post and a later tick
// retries the same slot, the second attempt must be able to overwrite its own
// earlier partial row rather than crashing on the unique constraint.
export async function saveChunk(
    period: string,
    slot: number,
    summary: string,
    msgCount: number
): Promise<boolean> {
    try {
        await prisma.reportChunk.upsert({
            where: { period_slot: { period, slot } },
            create: { period, slot, summary, msgCount },
            update: { summary, msgCount }
        });
        return true;
    } catch (error) {
        console.error(`[report] saveChunk ${period}#${slot} failed:`, error);
        return false;
    }
}

// Load the chunks backing one daily report. The caller passes the exact slot
// list it wants (which spans two calendar days), so this queries by the (period,
// slot) pairs rather than assuming a single period.
export async function loadChunks(
    wanted: Array<{ period: string; slot: number }>
): Promise<StoredChunk[]> {
    if (!wanted.length) return [];
    const rows = await prisma.reportChunk.findMany({
        where: { OR: wanted.map(w => ({ period: w.period, slot: w.slot })) },
        orderBy: [{ period: 'asc' }, { slot: 'asc' }]
    }).catch(error => {
        console.error('[report] loadChunks failed:', error);
        return [] as Array<{ slot: number; summary: string; msgCount: number }>;
    });
    // Empty slots are stored as rows but carry nothing to summarize; drop them
    // here so the reduce prompt isn't padded with blank sections.
    return rows
        .filter(r => r.summary.trim().length > 0)
        .map(r => ({ slot: r.slot, summary: r.summary, msgCount: r.msgCount }));
}

// Which of `wanted` already have a row, as a Set of "period#slot" keys.
//
// Deliberately does NOT reuse loadChunks: that one drops rows whose summary is
// empty, and an empty row is exactly how a genuinely quiet window is recorded. A
// backfill built on loadChunks would see every quiet night as a hole and pay for
// an AI call to re-summarize nothing, every single run.
export async function findStoredSlots(
    wanted: Array<{ period: string; slot: number }>
): Promise<Set<string>> {
    if (!wanted.length) return new Set();
    const rows = await prisma.reportChunk.findMany({
        where: { OR: wanted.map(w => ({ period: w.period, slot: w.slot })) },
        select: { period: true, slot: true }
    }).catch(error => {
        console.error('[report] findStoredSlots failed:', error);
        return null;
    });
    // Fail closed on a DB error: claiming everything is already stored makes the
    // backfill do nothing this run. The opposite default would spend AI tokens
    // re-summarizing a whole day because one query blipped.
    if (!rows) return new Set(wanted.map(w => `${w.period}#${w.slot}`));
    return new Set(rows.map(r => `${r.period}#${r.slot}`));
}

export async function hasChunk(period: string, slot: number): Promise<boolean> {
    const row = await prisma.reportChunk.findUnique({
        where: { period_slot: { period, slot } },
        select: { period: true }
    }).catch(() => null);
    return !!row;
}

// Drop chunks older than the retention window. Runs after a daily report posts,
// so a few days are kept for debugging a bad bulletin. period is zero-padded
// YYYY-MM-DD, which makes a lexicographic `lt` a correct date comparison.
export async function pruneOldChunks(nowMs = Date.now()): Promise<void> {
    const cutoff = periodDaysAgo(config.report.chunk.retentionDays, nowMs);
    await prisma.reportChunk.deleteMany({ where: { period: { lt: cutoff } } })
        .catch(error => console.error('[report] pruneOldChunks failed:', error));
}

// Drop the spent work-claims for windows that have aged out. These rows hold no
// summary text — they are only the "someone is already handling this slot" locks,
// one per slot plus one per daily post, and nothing reads them again once their
// slot has passed. Without this they are the one part of the nhật báo that grows
// without bound.
//
// Scoped to this channel AND to the report kinds on purpose. MaintenanceLog is
// shared: 'monthly-clear' rows in the same table are the record that a channel was
// already wiped this month, and deleting one would let the wipe run a second time.
export async function pruneOldChunkClaims(nowMs = Date.now()): Promise<void> {
    const cutoff = periodDaysAgo(config.report.chunk.retentionDays, nowMs);
    // Two period shapes share this column: 'YYYY-MM-DD' for the daily post and
    // 'YYYY-MM-DD#slot' for a chunk. A lexicographic `lt` is correct for both, and
    // it keeps the cutoff day itself: '2026-07-21#5' < '2026-07-22' is true, while
    // '2026-07-22#0' < '2026-07-22' is false because a prefix sorts first. The
    // weekly claim uses a plain Monday 'YYYY-MM-DD' period — same comparison works.
    await prisma.maintenanceLog.deleteMany({
        where: {
            channelId: config.report.forumChannel,
            kind: { in: ['report-chunk', 'report', 'report-weekly'] },
            period: { lt: cutoff }
        }
    }).catch(error => console.error('[report] pruneOldChunkClaims failed:', error));
}
