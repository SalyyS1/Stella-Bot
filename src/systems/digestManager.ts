import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';
import { messageLink } from '../utils/adminLog';

// Digest resurfaces still-open requests + recent showcases into a highlight
// channel so service posts don't die unseen. Idempotency is a UNIQUE-constraint
// row (MaintenanceLog kind='digest', period=<window key>) — NOT a last-run
// timestamp — so a per-process setInterval firing twice (multi-instance or
// restart) can't double-post: the second create hits the unique row and skips.

const DIGEST_KIND = 'digest';
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly check; the period key gates actual posting
const MAX_ITEMS = 10;

// Window key in Saigon time. Weekly cadence → ISO-week-ish key; daily → date key.
function currentPeriodKey(): string {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: config.maintenance.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(now);
    const year = parts.find(p => p.type === 'year')?.value || '0000';
    const month = parts.find(p => p.type === 'month')?.value || '00';
    const day = parts.find(p => p.type === 'day')?.value || '00';

    if (config.digest.cadence === 'daily') return `${year}-${month}-${day}`;

    // Weekly: bucket by the ISO-ish week number within the year (Saigon date).
    const saigonDate = new Date(`${year}-${month}-${day}T00:00:00`);
    const startOfYear = new Date(`${year}-01-01T00:00:00`);
    const dayOfYear = Math.floor((saigonDate.getTime() - startOfYear.getTime()) / 86_400_000) + 1;
    const week = Math.ceil(dayOfYear / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
}

async function buildDigestEmbed(client: Client, guildId: string | null): Promise<EmbedBuilder | null> {
    const openRequests = await prisma.requestPost.findMany({
        where: { status: { in: ['OPEN', 'CLAIMED'] } },
        orderBy: { createdAt: 'asc' },
        take: MAX_ITEMS
    });
    const recentShowcases = await prisma.showcasePost.findMany({
        where: { status: 'PUBLISHED' },
        orderBy: { publishedAt: 'desc' },
        take: MAX_ITEMS
    });

    // Skip when there is nothing worth resurfacing (no empty spam).
    if (openRequests.length === 0 && recentShowcases.length === 0) return null;

    const emojis = config.ui.emojis;
    const embed = new EmbedBuilder()
        .setColor('#f1c40f')
        .setTitle(`${emojis.starJump} Bảng tin dịch vụ Stella`)
        .setFooter({ text: 'Stella Studio • Digest' })
        .setTimestamp();

    if (openRequests.length) {
        const lines = openRequests.map(r => {
            const link = r.messageId ? messageLink(guildId, r.channelId, r.messageId) : null;
            const label = `#${r.id} · ${r.kind} · ${r.service.slice(0, 60)}`;
            return link ? `• [${label}](${link})` : `• ${label}`;
        });
        embed.addFields({ name: `${emojis.service} Yêu cầu đang mở (${openRequests.length})`, value: lines.join('\n').slice(0, 1024) });
    }
    if (recentShowcases.length) {
        const lines = recentShowcases.map(s => {
            const link = s.forumThreadId ? messageLink(guildId, s.forumThreadId, s.messageId) : null;
            const label = s.title.slice(0, 70);
            return link ? `• [${label}](${link})` : `• ${label}`;
        });
        embed.addFields({ name: `${emojis.star} Showcase mới (${recentShowcases.length})`, value: lines.join('\n').slice(0, 1024) });
    }
    return embed;
}

// Post the digest for the current window, once. force=true bypasses the period
// gate for an admin test trigger but still records the row for that window.
export async function runDigest(client: Client, force = false): Promise<'posted' | 'empty' | 'already'> {
    const period = currentPeriodKey();
    const channelId = config.channels.digest;

    if (!force) {
        const existing = await prisma.maintenanceLog.findUnique({
            where: { channelId_kind_period: { channelId, kind: DIGEST_KIND, period } }
        }).catch(() => null);
        if (existing) return 'already';
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !('send' in channel)) return 'empty';

    const guildId = 'guildId' in channel ? (channel as TextChannel).guildId : null;
    const embed = await buildDigestEmbed(client, guildId);
    if (!embed) return 'empty';

    // Claim the window BEFORE posting so a concurrent instance can't also post.
    // Unique violation → another instance already claimed → skip. force still
    // records the row so a manual /maintenance digest suppresses the next
    // scheduled run in the same window (no duplicate post).
    try {
        await prisma.maintenanceLog.create({
            data: { channelId, kind: DIGEST_KIND, period }
        });
    } catch {
        // Row already exists. On a forced admin trigger we still post (explicit
        // "post now"); a scheduled run would have returned 'already' above.
        if (!force) return 'already';
    }

    await (channel as TextChannel).send({ embeds: [embed] }).catch(() => {});
    return 'posted';
}

export function startDigestScheduler(client: Client): void {
    runDigest(client).catch(() => {});
    setInterval(() => {
        runDigest(client).catch(() => {});
    }, CHECK_INTERVAL_MS);
}
