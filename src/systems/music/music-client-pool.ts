import { Client } from 'discord.js';
import { LavalinkManager } from 'lavalink-client';
import { getLavalinkNodes, NODE_RETRY_AMOUNT, NODE_RETRY_DELAY_MS } from './music-node-config';

// ============================================================
//  MUSIC CLIENT POOL — moi bot client mot LavalinkManager rieng
// ============================================================
// Discord chi cho mot bot user o mot voice channel trong mot guild. Muon phat
// song song nhieu kenh voice thi phai co nhieu bot token. Mot Lavalink node
// phuc vu duoc tat ca vi moi client bat tay bang User-Id rieng va nhan
// sessionId rieng, nen player cua cung mot guild o 2 session la doc lap.
//
// Luu y khi sau nay them queue persistence dung chung (Redis/DB):
// QueueStoreManager cua lavalink-client key theo guildId, phai prefix them
// bot id neu khong 2 bot se ghi de queue cua nhau.

export type MusicClientRole = 'main' | 'satellite';

export type MusicClientEntry = {
    key: string;
    label: string;
    role: MusicClientRole;
    client: Client;
    lavalink: any;
};

const entries: MusicClientEntry[] = [];

export function listMusicEntries(): MusicClientEntry[] {
    return entries.slice();
}

export function getMainMusicEntry(): MusicClientEntry | null {
    return entries.find(entry => entry.role === 'main') || null;
}

export function findMusicEntryByClient(client: Client): MusicClientEntry | null {
    return entries.find(entry => entry.client === client) || null;
}

function createLavalinkManager(client: Client, clientId: string, username: string) {
    const nodes = getLavalinkNodes();
    return new LavalinkManager({
        nodes: nodes.map(node => ({ ...node, retryAmount: NODE_RETRY_AMOUNT, retryDelay: NODE_RETRY_DELAY_MS })),
        sendToShard: (guildId: string, payload: any) => client.guilds.cache.get(guildId)?.shard?.send(payload),
        autoSkip: true,
        client: { id: clientId, username },
        playerOptions: {
            defaultSearchPlatform: 'ytmsearch',
            volumeDecrementer: 0.75,
            onEmptyQueue: { destroyAfterMs: 30_000 },
            onDisconnect: { autoReconnect: true, destroyPlayer: false }
        }
    });
}

/**
 * Dang ky mot bot client vao pool music. Tra null neu thieu env Lavalink
 * hoac client da duoc dang ky truoc do.
 */
export function registerMusicClient(options: {
    client: Client;
    key: string;
    label: string;
    role: MusicClientRole;
    clientId?: string;
}): MusicClientEntry | null {
    const nodes = getLavalinkNodes();
    if (!nodes.length) return null;
    if (findMusicEntryByClient(options.client)) return null;

    const clientId = options.clientId || options.client.user?.id || '';
    const entry: MusicClientEntry = {
        key: options.key,
        label: options.label,
        role: options.role,
        client: options.client,
        lavalink: createLavalinkManager(options.client, clientId, options.client.user?.username || options.label)
    };
    entries.push(entry);
    // Giu field cu tren client de code ngoai module music van doc duoc.
    (options.client as any).lavalink = entry.lavalink;
    options.client.on('raw', payload => entry.lavalink.sendRawData(payload));
    return entry;
}

/**
 * Bo mot client khoi pool. Dung khi login that bai: mot entry co client chet
 * van hien trong /music health nhu mot loa dang san sang, gay hieu nham.
 */
export function unregisterMusicClient(client: Client) {
    const index = entries.findIndex(entry => entry.client === client);
    if (index >= 0) entries.splice(index, 1);
}

/** Goi trong event ready: luc nay client.user da co that. */
export function initLavalink(client: Client) {
    const entry = findMusicEntryByClient(client);
    if (!entry || !client.user) return;
    entry.lavalink.init({ id: client.user.id, username: client.user.username });
}
