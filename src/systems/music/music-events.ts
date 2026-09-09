import { getMainMusicEntry, MusicClientEntry } from './music-client-pool';
import { forgetPanelMessage, refreshSessionPanel } from './music-panel-message';
import { sessionFromPlayer } from './music-session-router';

// ============================================================
//  MUSIC EVENTS — noi event Lavalink vao panel + log
// ============================================================

async function sendToTextChannel(textChannelId: string, content: string) {
    // Luon gui bang bot chinh: satellite chi lam loa, khong chat.
    const main = getMainMusicEntry();
    if (!main || !textChannelId) return;
    const channel = await main.client.channels.fetch(textChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;
    await (channel as any).send?.(content).catch(() => {});
}

export function attachMusicEntryEvents(entry: MusicClientEntry) {
    entry.lavalink.nodeManager.on('connect', (node: any) => console.log(`[Lavalink][${entry.label}] Node connected: ${node.id}`));
    entry.lavalink.nodeManager.on('error', (node: any, error: any) => console.error(`[Lavalink][${entry.label}] Node error ${node?.id}:`, error?.message || error));
    entry.lavalink.nodeManager.on('disconnect', (node: any, reason: any) => console.error(`[Lavalink][${entry.label}] Node disconnected ${node?.id}:`, reason));

    entry.lavalink.on('debug', (eventKey: string, eventData: any) => {
        if (eventData?.state === 'log') return;
        console.warn(`[Lavalink][${entry.label}][${eventKey}] ${eventData?.message || ''}`);
    });

    entry.lavalink.on('playerCreate', (player: any) => {
        console.log(`[Lavalink][${entry.label}] Player created: guild ${player?.guildId}, voice ${player?.voiceChannelId || player?.options?.voiceChannelId || 'unknown'}`);
    });

    // Doi bai -> render lai card cho panel dang mo.
    entry.lavalink.on('trackStart', async (player: any, track: any) => {
        console.log(`[Lavalink][${entry.label}] Track started: ${track?.info?.title || 'unknown'} (voice connected: ${Boolean(player?.connected)})`);
        await refreshSessionPanel(sessionFromPlayer(entry, player)).catch(() => {});
    });

    entry.lavalink.on('queueEnd', async (player: any) => {
        await refreshSessionPanel(sessionFromPlayer(entry, player)).catch(() => {});
        await sendToTextChannel(String(player.textChannelId || ''), 'Queue đã hết, Stella sẽ rời voice nếu không có bài mới.');
    });

    entry.lavalink.on('playerDestroy', (player: any, reason: any) => {
        console.warn(`[Lavalink][${entry.label}] Player destroyed: guild ${player?.guildId || 'unknown'} — ${reason || 'unknown reason'}`);
        forgetPanelMessage(entry.key, String(player?.guildId || ''));
    });

    entry.lavalink.on('trackError', (player: any, track: any, payload: any) => {
        console.error(`[Lavalink][${entry.label}] Track error: ${track?.info?.title || 'unknown'} —`, payload?.exception?.message || payload?.error || '');
    });

    entry.lavalink.on('trackStuck', (_player: any, track: any, payload: any) => {
        console.error(`[Lavalink][${entry.label}] Track stuck: ${track?.info?.title || 'unknown'} — threshold ${payload?.thresholdMs ?? 'unknown'}ms`);
    });
}
