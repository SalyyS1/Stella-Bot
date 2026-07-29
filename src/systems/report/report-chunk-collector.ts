import { Client, TextChannel } from 'discord.js';
import { config } from '../../config';

// Reads raw chat for ONE time window out of the configured source channels.
// Nothing is persisted: the text lives only long enough to be summarized, same
// privacy stance the nightly report always had.

export interface CollectedChat {
    text: string;
    msgCount: number;
    // Did the walk actually get back past the start of the window? False means we
    // ran out of page budget on the way there, so an empty result proves nothing
    // about the window — see the caller, which must not record it as a quiet one.
    reachedStart: boolean;
}

// Walk a channel's history backwards until we're past `sinceMs`. Unlike the old
// 24h gather this has no fixed page cap: a 3h window normally fits in one page,
// and the loop's real bound is the timestamp check, so a busy window is read in
// full instead of being silently cut off at page 2. maxPages only exists to stop
// a pathological channel from looping forever.
async function collectChannel(
    client: Client,
    channelId: string,
    sinceMs: number,
    untilMs: number,
    maxPages = config.report.chunk.maxPagesPerChannel
): Promise<{ name: string; lines: string[]; reachedStart: boolean } | null> {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    // null = could not fetch: transient or a permission change, so the window is
    // left unproven and a retry may still succeed.
    if (!channel) return null;
    // Resolved but not a text channel = a wrong id in sourceChannels, which no
    // retry will fix. Counting it as unproven would keep every quiet window
    // permanently unrecordable and make the backfill re-walk history every tick,
    // so it is reported as "nothing here, and that is settled".
    if (!channel.isTextBased() || !('messages' in channel)) {
        console.error(`[report] kênh ${channelId} không phải kênh text — bỏ qua`);
        return { name: channelId, lines: [], reachedStart: true };
    }

    const lines: string[] = [];
    let before: string | undefined;
    // Turns true only once we have seen a message older than the window, or run
    // out of history altogether. Exhausting maxPages leaves it false, which is the
    // signal that an empty result means "never got there", not "nothing there".
    let reachedStart = false;

    for (let page = 0; page < maxPages; page++) {
        const batch = await (channel as TextChannel).messages
            .fetch({ limit: 100, ...(before ? { before } : {}) })
            .catch(() => null);
        // A failed fetch proves nothing about the window, so reachedStart stays
        // false. An exhausted history does prove it: nothing older exists.
        if (!batch) break;
        if (batch.size === 0) {
            reachedStart = true;
            break;
        }

        for (const msg of batch.values()) {
            before = msg.id;
            if (msg.author.bot) continue;
            // Two-sided window. The upper bound matters: without it a slot that
            // runs late would absorb messages belonging to the NEXT slot, and
            // that slot would then summarize them a second time.
            if (msg.createdTimestamp < sinceMs) continue;
            if (msg.createdTimestamp >= untilMs) continue;
            const content = msg.content.replace(/\s+/g, ' ').trim();
            if (content) lines.push(`${msg.author.username}: ${content.slice(0, 300)}`);
        }

        const oldest = batch.last();
        if (oldest && oldest.createdTimestamp < sinceMs) {
            reachedStart = true;
            break;
        }
    }

    // Always returns an object, even for an empty window: the old `null` here threw
    // reachedStart away, and that flag is the whole point of the walk when a window
    // turns up nothing.
    const name = 'name' in channel ? (channel as TextChannel).name : channelId;
    return { name, lines: lines.reverse(), reachedStart };
}

// Gather every source channel for one window. Channels are read sequentially:
// this is a background job on a 3h cadence, so there is nothing to gain from
// parallel fetches and sequential keeps us far away from Discord's rate limits.
// maxPages is overridable because a backfill has to page much further back than a
// live slot: history is walked newest-first, so reaching a window that closed 18h
// ago means stepping over every message posted since. The live default would hit
// its cap before arriving and return an empty window that looks like a quiet one.
export async function collectChunkChat(
    client: Client,
    sinceMs: number,
    untilMs: number,
    maxPages = config.report.chunk.maxPagesPerChannel
): Promise<CollectedChat> {
    const blocks: string[] = [];
    let msgCount = 0;
    // Every channel has to have got back past the window start before an empty
    // result can be believed. One channel short of budget, or one unreadable, is
    // enough to leave the whole window unproven.
    let reachedStart = true;

    for (const channelId of config.report.sourceChannels) {
        const collected = await collectChannel(client, channelId, sinceMs, untilMs, maxPages).catch(() => null);
        if (!collected) {
            reachedStart = false;
            continue;
        }
        if (!collected.reachedStart) reachedStart = false;
        if (!collected.lines.length) continue;
        msgCount += collected.lines.length;
        blocks.push(`# Kênh ${collected.name}\n${collected.lines.join('\n')}`);
    }

    return { text: blocks.join('\n\n'), msgCount, reachedStart };
}
