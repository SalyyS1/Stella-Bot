// Shared SSRF guard for every outbound fetch driven by content the bot did not
// author (wiki pages, research results, member-supplied links).
//
// Lifted out of aiQaManager, which was the only caller until the report gained
// web research. Two callers meant two copies drifting apart, and the copy that
// fell behind would be the one handling the riskier input — research URLs derive
// from member chat, whereas the wiki catalog is admin-curated.
//
// Hostname-based on purpose: it does NOT resolve DNS, so a name pointing at an
// internal address still gets through. That is an accepted limit — this blocks
// the obvious metadata/localhost/private-range targets cheaply, and callers pair
// it with redirect:'manual' so a redirect cannot smuggle them somewhere else.

export function isSafePublicHttpsUrl(raw: string): boolean {
    let u: URL;
    try {
        u = new URL(raw);
    } catch {
        return false;
    }
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '::1' || host.endsWith('.localhost')) return false;
    // IPv4 literal → block loopback / link-local / private ranges.
    const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) {
        const [a, b] = [Number(m[1]), Number(m[2])];
        if (a === 127 || a === 10 || a === 0) return false;              // loopback / private / this-host
        if (a === 169 && b === 254) return false;                        // link-local (cloud metadata)
        if (a === 172 && b >= 16 && b <= 31) return false;               // private
        if (a === 192 && b === 168) return false;                        // private
    }
    // IPv6 literal → block loopback / unique-local / link-local.
    if (host.includes(':') && (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80'))) return false;
    return true;
}

// Fetch a page and reduce it to plain text for AI context. https-only, no
// redirect following, hard timeout that stays armed through the body read (a slow
// drip would otherwise hang with no ceiling), and a byte cap before decoding.
export async function fetchPageText(
    url: string,
    opts: { timeoutMs?: number; maxBytes?: number; maxChars?: number } = {}
): Promise<string | null> {
    if (!isSafePublicHttpsUrl(url)) return null;
    const timeoutMs = opts.timeoutMs ?? 8_000;
    const maxBytes = opts.maxBytes ?? 200_000;
    const maxChars = opts.maxChars ?? 3_000;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        // redirect:'manual' — do NOT auto-follow to a possibly-internal host.
        const res = await fetch(url, { signal: controller.signal, redirect: 'manual' });
        if (!res.ok) return null;
        const html = (await res.text()).slice(0, maxBytes);
        const text = html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&[a-z#0-9]+;/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return text.slice(0, maxChars) || null;
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}
