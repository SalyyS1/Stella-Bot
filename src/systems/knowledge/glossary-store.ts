import prisma from '../../lib/prisma';
import { config } from '../../config';

// Persistence for community jargon Stella doesn't know yet. A term row moves
// through three states:
//
//   asked, unanswered  -> meaning null, askedAt set
//   answered           -> meaning + answeredBy + answeredAt set
//   (deleted)          -> an admin removed a wrong definition
//
// The answered set is what later bulletins read, so a wrong meaning would be
// reused every day until someone removes it. That is why every answer records
// who gave it and which message it came from.

export interface GlossaryEntry {
    term: string;
    meaning: string;
}

// Terms are matched case-insensitively; the id is always the lowercased form so
// "MythicMobs" and "mythicmobs" can never become two rows with two meanings.
export function normalizeTerm(raw: string): string {
    return raw.trim().toLowerCase();
}

function isAcceptableTerm(term: string): boolean {
    if (term.length < config.knowledge.minTermLen) return false;
    if (term.length > config.knowledge.maxTermLen) return false;
    // A "term" with newlines or many words is the AI drifting into a sentence.
    if (/[\n\r]/.test(term)) return false;
    if (term.split(/\s+/).length > config.knowledge.maxTermWords) return false;
    return true;
}

// Drop terms that are already known or already pending an answer, and cap the
// batch. Without this filter the bot re-asks the same words every slot and the
// knowledge channel turns into spam — the single most likely failure of this
// feature. Re-asking IS allowed once a pending term goes stale (see below), so a
// question that everyone happened to miss isn't lost forever.
export async function selectTermsToAsk(candidates: string[]): Promise<string[]> {
    const normalized = Array.from(new Set(candidates.map(normalizeTerm))).filter(isAcceptableTerm);
    if (!normalized.length) return [];

    const existing = await prisma.glossaryTerm.findMany({
        where: { term: { in: normalized } },
        select: { term: true, meaning: true, askedAt: true, askCount: true }
    }).catch(error => {
        console.error('[glossary] selectTermsToAsk lookup failed:', error);
        // Fail closed: asking nothing is strictly better than re-asking everything.
        return null;
    });
    if (!existing) return [];

    const known = new Map(existing.map(row => [row.term, row]));
    const staleBefore = Date.now() - config.knowledge.reAskAfterDays * 86_400_000;

    const fresh = normalized.filter(term => {
        const row = known.get(term);
        if (!row) return true;                       // never seen
        if (row.meaning) return false;               // already answered
        if (row.askCount >= config.knowledge.maxAsksPerTerm) return false;
        // Pending but nobody answered: retry only once it has gone stale.
        return !row.askedAt || row.askedAt.getTime() < staleBefore;
    });

    return fresh.slice(0, config.knowledge.maxTermsPerAsk);
}

// Record that a batch was asked. Done in ONE call after the question message
// posts successfully: marking them asked before posting would silently lose the
// terms if the post failed.
export async function markAsked(terms: string[]): Promise<void> {
    for (const term of terms) {
        await prisma.glossaryTerm.upsert({
            where: { term },
            create: { term, askedAt: new Date(), askCount: 1 },
            update: { askedAt: new Date(), askCount: { increment: 1 } }
        }).catch(error => console.error(`[glossary] markAsked ${term} failed:`, error));
    }
}

// Store a meaning supplied by a trusted member. Returns false when the term was
// never asked — answers are only accepted for questions Stella actually posed,
// so a random trusted message can't inject arbitrary vocabulary.
export async function recordAnswer(
    term: string,
    meaning: string,
    answeredBy: string,
    sourceMsg: string
): Promise<boolean> {
    const key = normalizeTerm(term);
    const trimmed = meaning.trim().slice(0, config.knowledge.maxMeaningLen);
    if (trimmed.length < config.knowledge.minMeaningLen) return false;

    const existing = await prisma.glossaryTerm.findUnique({
        where: { term: key },
        select: { term: true }
    }).catch(() => null);
    if (!existing) return false;

    const saved = await prisma.glossaryTerm.update({
        where: { term: key },
        data: { meaning: trimmed, answeredBy, sourceMsg, answeredAt: new Date() }
    }).catch(error => {
        console.error(`[glossary] recordAnswer ${key} failed:`, error);
        return null;
    });
    return !!saved;
}

// Answered terms for injecting into report prompts. Capped so a large glossary
// can't crowd out the actual chat summaries in the context window.
export async function getAnsweredTerms(limit = config.knowledge.maxTermsInContext): Promise<GlossaryEntry[]> {
    const rows = await prisma.glossaryTerm.findMany({
        where: { NOT: { meaning: null } },
        orderBy: { answeredAt: 'desc' },
        take: limit,
        select: { term: true, meaning: true }
    }).catch(error => {
        console.error('[glossary] getAnsweredTerms failed:', error);
        return [] as Array<{ term: string; meaning: string | null }>;
    });
    return rows
        .filter((r): r is { term: string; meaning: string } => !!r.meaning)
        .map(r => ({ term: r.term, meaning: r.meaning }));
}

// Which of the pending questions are still open, so the answer collector knows
// what to look for without re-reading the whole table per message.
export async function getPendingTerms(): Promise<string[]> {
    const rows = await prisma.glossaryTerm.findMany({
        where: { meaning: null },
        orderBy: { askedAt: 'desc' },
        take: config.knowledge.maxTermsInContext,
        select: { term: true }
    }).catch(() => []);
    return rows.map(r => r.term);
}

// Admin removal for a wrong definition. Returns whether a row was actually hit.
export async function deleteTerm(term: string): Promise<boolean> {
    const result = await prisma.glossaryTerm
        .deleteMany({ where: { term: normalizeTerm(term) } })
        .catch(error => {
            console.error('[glossary] deleteTerm failed:', error);
            return { count: 0 };
        });
    return result.count > 0;
}

// Admin listing: everything, answered first, for auditing what Stella believes.
export async function listTerms(limit = 50): Promise<Array<{
    term: string;
    meaning: string | null;
    answeredBy: string | null;
}>> {
    return prisma.glossaryTerm.findMany({
        orderBy: [{ answeredAt: 'desc' }, { askedAt: 'desc' }],
        take: limit,
        select: { term: true, meaning: true, answeredBy: true }
    }).catch(() => []);
}
