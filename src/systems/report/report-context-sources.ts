import prisma from '../../lib/prisma';
import { config } from '../../config';

// Non-chat context for the daily bulletin: the live service board (open requests
// + recent showcases) and the official Minecraft patch notes. Both are read at
// reduce time rather than per chunk — they describe current state, not what
// happened in a particular 3h window, so sampling them 8x/day would only add
// cost and let a stale early-morning snapshot outvote the evening truth.

export async function gatherServiceBoard(): Promise<string> {
    const [openRequests, showcases] = await Promise.all([
        prisma.requestPost.findMany({
            where: { status: { in: ['OPEN', 'CLAIMED'] } },
            orderBy: { createdAt: 'asc' },
            take: 15
        }).catch(() => []),
        prisma.showcasePost.findMany({
            where: { status: 'PUBLISHED' },
            orderBy: { publishedAt: 'desc' },
            take: 10
        }).catch(() => [])
    ]);
    const lines: string[] = [];
    if (openRequests.length) {
        lines.push('Yêu cầu đang mở:');
        for (const r of openRequests) lines.push(`- #${r.id} [${r.kind}] ${r.service}: ${r.description.slice(0, 120)}`);
    }
    if (showcases.length) {
        lines.push('Showcase mới:');
        for (const s of showcases) lines.push(`- ${s.title.slice(0, 120)}`);
    }
    return lines.join('\n');
}

// Fetch the official Mojang Java patch-notes JSON (stable, preferred over HTML
// scraping). Fail-soft: return null on any error so the bulletin still posts.
export async function fetchChangelog(): Promise<string | null> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8_000);
        const res = await fetch(config.report.changelogUrl, { signal: controller.signal })
            .finally(() => clearTimeout(timeout));
        if (!res.ok) return null;
        const json: any = await res.json().catch(() => null);
        const latest = json?.entries?.[0];
        if (!latest) return null;
        const body = String(latest.body || '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 1500);
        return `${latest.title || 'Bản cập nhật mới'}\n${body}`;
    } catch {
        return null;
    }
}
