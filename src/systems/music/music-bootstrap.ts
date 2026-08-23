import { Client } from 'discord.js';
import { registerMusicClient } from './music-client-pool';
import { attachMusicEntryEvents } from './music-events';
import { getLavalinkNodes } from './music-node-config';

// ============================================================
//  MUSIC BOOTSTRAP — dung pool bot nhac luc khoi dong
// ============================================================

/** Goi truoc khi bot chinh login. */
export function setupLavalink(client: Client) {
    const nodes = getLavalinkNodes();
    if (!nodes.length) {
        console.warn('Lavalink env is missing. Music playback is disabled.');
        return;
    }

    const entry = registerMusicClient({
        client,
        key: 'main',
        label: 'Stella',
        role: 'main',
        clientId: process.env.CLIENT_ID || client.user?.id || ''
    });
    if (!entry) return;

    attachMusicEntryEvents(entry);
    console.log(`[Lavalink] Configured ${nodes.length} node(s): ${nodes.map(node => `${node.id}@${node.host}:${node.port}${node.secure ? ' secure' : ''}`).join(', ')}`);
}
