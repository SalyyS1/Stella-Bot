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

    // Doi bai -> render lai card cho panel dang mo.
    entry.lavalink.on('trackStart', async (player: any) => {
        await refreshSessionPanel(sessionFromPlayer(entry, player), { newCard: true }).catch(() => {});
    });

    entry.lavalink.on('queueEnd', async (player: any) => {
        await refreshSessionPanel(sessionFromPlayer(entry, player)).catch(() => {});
        await sendToTextChannel(String(player.textChannelId || ''), 'Queue đã hết, Stella sẽ rời voice nếu không có bài mới.');
    });

    entry.lavalink.on('playerDestroy', (player: any) => {
        forgetPanelMessage(entry.key, String(player?.guildId || ''));
    });

    entry.lavalink.on('trackError', (player: any, track: any, payload: any) => {
        console.error(`[Lavalink][${entry.label}] Track error: ${track?.info?.title || 'unknown'} —`, payload?.exception?.message || payload?.error || '');
    });
}
