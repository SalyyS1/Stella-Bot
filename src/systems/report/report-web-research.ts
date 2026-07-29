import { config } from '../../config';
import { fetchPageText, isSafePublicHttpsUrl } from '../../utils/safe-public-url';

// Looks up outside information for a topic the community discussed, so the daily
// bulletin can say something true about a plugin or update rather than repeating
// what members guessed.
//
// The model does NOT choose URLs. A search API returns JSON, and only the hosts it
// names are fetched — which keeps the SSRF surface to a list the provider produced
// rather than to anything a member could type into chat.
//
// This is a choice, not a limitation: a probe on 2026-07-29 showed the gateway does
// accept `tools` and does answer with a real tool_call, so "let the AI search" WAS
// on the table. It stays off because a model-chosen URL is a model-chosen fetch
// target, and the request would be made by the bot's own host. aiClient also strips
// tool-call XML and the Q&A prompt denies having tools, so nothing in the report
// path could act on a tool_call even if one arrived.
//
// Fail-closed: without RESEARCH_API_KEY this whole module is inert and the report
// behaves exactly as it did before. That is deliberate — web research is the most
// expensive and least necessary part of the nhật báo, so it stays off until
// someone decides it is worth paying for.

interface SearchHit {
    title: string;
    url: string;
    snippet: string;
}

export function isResearchEnabled(): boolean {
    return config.report.research.enabled
        && !!process.env.RESEARCH_API_KEY
        && !!config.report.research.searchUrl;
}

// Query the search provider. Tavily-compatible JSON POST (also what most
// OpenAI-adjacent search gateways expose); a different provider only needs this
// one function changed, not the calling code.
async function search(query: string): Promise<SearchHit[]> {
    const key = process.env.RESEARCH_API_KEY;
    if (!key) return [];
    if (!isSafePublicHttpsUrl(config.report.research.searchUrl)) return [];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.report.research.timeoutMs);
    try {
        const res = await fetch(config.report.research.searchUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${key}`
            },
            body: JSON.stringify({
                query,
                max_results: config.report.research.maxResults,
                search_depth: 'basic'
            }),
            signal: controller.signal
        });
        if (!res.ok) {
            // The key must never reach a log, and a provider error body can echo the
            // request back — so only the status is recorded.
            console.error(`[research] search HTTP ${res.status}`);
            return [];
        }
        const json: any = await res.json().catch(() => null);
        const results: any[] = Array.isArray(json?.results) ? json.results : [];
        return results
            .map(r => ({
                title: String(r?.title || '').slice(0, 200),
                url: String(r?.url || ''),
                snippet: String(r?.content || r?.snippet || '').slice(0, 500)
            }))
            // Re-validate every URL the provider returned. A compromised or sloppy
            // provider must not be able to steer the bot at an internal address.
            .filter(hit => hit.url && isSafePublicHttpsUrl(hit.url));
    } catch (error) {
        console.error('[research] search failed:', error instanceof Error ? error.message : 'unknown');
        return [];
    } finally {
        clearTimeout(timeout);
    }
}

// Pick what is worth looking up, without spending an AI call to decide.
//
// The caller passes the jargon the community explained today: concrete nouns tied
// to real demand, and already filtered by a human answering the question. A
// model-chosen topic list would cost another call per report and would be free to
// invent a subject nobody mentioned, which is exactly what the report must not do.
export function pickResearchTopics(candidates: string[]): string[] {
    const seen = new Set<string>();
    const picked: string[] = [];
    for (const raw of candidates) {
        const topic = raw.trim();
        if (topic.length < 3 || topic.length > 60) continue;
        const key = topic.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        picked.push(topic);
        if (picked.length >= config.report.research.maxTopicsPerReport) break;
    }
    return picked;
}

// Research several topics and label each block, so the composer can tell which
// facts belong to which subject. Sequential on purpose: this runs once a day in a
// background job, and serial requests keep well clear of provider rate limits.
export async function researchTopics(topics: string[]): Promise<string | null> {
    if (!isResearchEnabled() || !topics.length) return null;
    const blocks: string[] = [];
    for (const topic of topics) {
        const found = await researchTopic(topic).catch(() => null);
        if (found) blocks.push(`## ${topic}\n${found}`);
    }
    if (!blocks.length) return null;
    return blocks.join('\n\n').slice(0, config.report.research.maxTotalChars);
}

// Research one topic: search, then read the top pages for real detail. Snippets
// alone are usually too thin to say anything useful, but fetching every hit is
// slow — so only the first few are opened.
export async function researchTopic(topic: string): Promise<string | null> {
    if (!isResearchEnabled()) return null;
    const clean = topic.trim().slice(0, 200);
    if (clean.length < 3) return null;

    const hits = await search(clean);
    if (!hits.length) return null;

    const blocks: string[] = [];
    for (const hit of hits.slice(0, config.report.research.maxPagesToRead)) {
        const body = await fetchPageText(hit.url, {
            timeoutMs: config.report.research.timeoutMs,
            maxChars: config.report.research.maxCharsPerPage
        }).catch(() => null);
        // Fall back to the provider's snippet when the page itself can't be read
        // (paywall, JS-only, redirect) — a short true line still beats nothing.
        const text = body || hit.snippet;
        if (!text) continue;
        blocks.push(`### ${hit.title}\n${hit.url}\n${text}`);
    }

    if (!blocks.length) return null;
    return blocks.join('\n\n').slice(0, config.report.research.maxTotalChars);
}
