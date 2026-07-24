import prisma from '../lib/prisma';
import { config } from '../config';

// DB-backed catalog of plugin wiki links the AI consults for plugin questions.
// Seeded with popular plugins on ready (create-if-absent, never overwrites an
// admin edit); admins extend via /add wiki.

export interface WikiMatch {
    name: string;
    url: string;
}

function normalize(input: string): string {
    return input.trim().toLowerCase();
}

export function isHttpUrl(url: string): boolean {
    try {
        const u = new URL(url);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

// Create seed entries that don't exist yet. Never updates an existing row so an
// admin's later edit is preserved.
export async function seedWikis(): Promise<void> {
    for (const seed of config.ai.seedWikis) {
        try {
            await prisma.wikiEntry.upsert({
                where: { name: normalize(seed.name) },
                update: {}, // create-if-absent only
                create: {
                    name: normalize(seed.name),
                    url: seed.url,
                    aliases: seed.aliases || null,
                    addedBy: 'seed'
                }
            });
        } catch (error) {
            console.error(`Wiki seed failed for ${seed.name}:`, error);
        }
    }
}

// Admin add/update. Returns false on invalid URL.
export async function addWiki(name: string, url: string, actorId: string, aliases?: string): Promise<boolean> {
    if (!isHttpUrl(url)) return false;
    const key = normalize(name);
    if (!key) return false;
    await prisma.wikiEntry.upsert({
        where: { name: key },
        update: { url, aliases: aliases || null, addedBy: actorId },
        create: { name: key, url, aliases: aliases || null, addedBy: actorId }
    });
    return true;
}

export async function listWikiEntries(): Promise<{ name: string; url: string; aliases: string | null }[]> {
    return prisma.wikiEntry.findMany({ orderBy: { name: 'asc' } }).catch(() => []);
}

// Find the wiki entry a question refers to. Matches the entry name or any alias
// as a whole-word-ish substring of the (lowercased) question. Returns the first
// match, or null. Kept simple (KISS) — no fuzzy scoring.
export async function findWikiEntry(question: string): Promise<WikiMatch | null> {
    const q = ` ${normalize(question)} `;
    const entries = await listWikiEntries();
    for (const entry of entries) {
        const keys = [entry.name, ...(entry.aliases ? entry.aliases.split(',') : [])]
            .map(k => normalize(k))
            .filter(Boolean);
        for (const key of keys) {
            // Word-boundary match only. A raw substring test made short aliases
            // (mm, dm, lp, wg) match "command"/"admin"/"random" → wrong wiki fetched.
            if (q.includes(` ${key} `)) {
                return { name: entry.name, url: entry.url };
            }
        }
    }
    return null;
}
