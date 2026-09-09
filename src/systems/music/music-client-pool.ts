import { Client } from 'discord.js';
import { LavalinkManager } from 'lavalink-client';
import { autoplayRelatedTracks } from './music-autoplay';
import { getLavalinkNodes, NODE_REQUEST_TIMEOUT_MS, NODE_RETRY_AMOUNT, NODE_RETRY_DELAY_MS } from './music-node-config';

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
        nodes: nodes.map(node => ({
            ...node,
            retryAmount: NODE_RETRY_AMOUNT,
            retryDelay: NODE_RETRY_DELAY_MS,
            requestSignalTimeoutMS: NODE_REQUEST_TIMEOUT_MS
        })),
        sendToShard: (guildId: string, payload: any) => client.guilds.cache.get(guildId)?.shard?.send(payload),
        autoSkip: true,
        client: { id: clientId, username },
        advancedOptions: {
            enableDebugEvents: true,
            // Thu vien bao "No Player" cho ca voice-state khong lien quan va
            // lam log rat nhieu. Router tu log/repair voice mo coi ro rang hon.
            debugOptions: { noAudio: false }
        },
        playerOptions: {
            defaultSearchPlatform: 'ytmsearch',
            volumeDecrementer: 0.75,
            // autoPlayFunction chi lam gi khi player bat autoplay; tat thi queue
            // het la roi voice sau 30s nhu cu.
            onEmptyQueue: {
                destroyAfterMs: 30_000,
                autoPlayFunction: async (player: any, lastTrack: any) => {
                    await autoplayRelatedTracks(player, lastTrack).catch(() => 0);
                }
            },
            onDisconnect: { autoReconnect: true, destroyPlayer: false }
        }
    });
}

const VOICE_UPDATE_RETRY_DELAY_MS = 1_000;

function errorText(error: any) {
    return error?.stack || error?.message || String(error);
}

/**
 * Forward Discord gateway voice data without returning a rejecting Promise to
 * discord.js' EventEmitter (which would mislabel it as "Discord client error").
 * VOICE_SERVER_UPDATE is safe to retry: Lavalink's PATCH is idempotent and a
 * timeout can happen after its remote voice connection has nearly completed.
 */
async function forwardRawData(entry: MusicClientEntry, payload: any) {
    const eventName = String(payload?.t || 'unknown');
    const maxAttempts = eventName === 'VOICE_SERVER_UPDATE' ? 2 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await entry.lavalink.sendRawData(payload);
            if (attempt > 1) console.log(`[Lavalink][${entry.label}] ${eventName} retry succeeded.`);
            return;
        } catch (error: any) {
            const willRetry = attempt < maxAttempts && error?.name === 'TimeoutError';
            console.error(
                `[Lavalink][${entry.label}] Gateway forward failed (${eventName}, attempt ${attempt}/${maxAttempts})${willRetry ? '; retrying' : ''}:`,
                errorText(error)
            );
            if (!willRetry) return;
            await new Promise(resolve => setTimeout(resolve, VOICE_UPDATE_RETRY_DELAY_MS));
        }
    }
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
    options.client.on('raw', payload => {
        void forwardRawData(entry, payload);
    });
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
export async function initLavalink(client: Client): Promise<void> {
    const entry = findMusicEntryByClient(client);
    if (!entry || !client.user) return;
    await entry.lavalink.init({ id: client.user.id, username: client.user.username });
}
