import { Client, GatewayIntentBits } from 'discord.js';
import { initLavalink, listMusicEntries, registerMusicClient, unregisterMusicClient } from './music-client-pool';
import { attachMusicEntryEvents } from './music-events';
import { getLavalinkNodes } from './music-node-config';

// ============================================================
//  MUSIC SATELLITE BOOTSTRAP — bot "loa" phu de phat song song
// ============================================================
// Discord chi cho MOT bot user o MOT voice channel trong mot guild. Vay nen
// muon kenh voice 1 va kenh voice 2 phat 2 bai khac nhau cung luc thi bat buoc
// phai co bot thu hai — khong co cach nao lam bang mot token.
//
// Satellite CHI lam loa: intent toi thieu (Guilds + GuildVoiceStates), khong
// load command, khong doc/gui tin nhan. Moi thu nguoi dung thay van do bot
// chinh gui (xem sendToTextChannel trong music-events).
//
// Cac satellite dung chung Lavalink node voi bot chinh: node phan biet client
// bang User-Id nen player cua cung mot guild o 2 session la doc lap.

/** Token bot phu, phan tach bang dau phay. Thieu env = tinh nang tat han. */
export function getSatelliteTokens(): string[] {
    return (process.env.MUSIC_SATELLITE_TOKENS || '')
        .split(',')
        .map(token => token.trim())
        .filter(Boolean);
}

function createSatelliteClient() {
    return new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
        allowedMentions: { parse: [] }
    });
}

/**
 * Login toan bo bot loa. Loi cua mot token KHONG lam chet bot chinh: satellite
 * la tinh nang phu, mat no thi chi con phat mot kenh cung luc.
 */
export async function startSatelliteMusicBots(): Promise<number> {
    const mainToken = (process.env.BOT_TOKEN || '').trim();
    const seenTokens = new Set<string>();
    const tokens = getSatelliteTokens().filter(token => {
        if (token === mainToken) {
            console.error('[music] Bo qua token loa phu trung BOT_TOKEN; moi loa phai la mot Discord bot rieng.');
            return false;
        }
        if (seenTokens.has(token)) {
            console.error('[music] Bo qua token loa phu bi lap trong MUSIC_SATELLITE_TOKENS.');
            return false;
        }
        seenTokens.add(token);
        return true;
    });
    if (!tokens.length) return 0;

    if (!getLavalinkNodes().length) {
        console.warn('[music] Có MUSIC_SATELLITE_TOKENS nhưng thiếu LAVALINK_* — bỏ qua bot loa phụ.');
        return 0;
    }

    let started = 0;
    for (let index = 0; index < tokens.length; index++) {
        // Bot chinh la "loa 1" nen satellite dau tien duoc goi la loa 2.
        const label = `Stella Loa ${index + 2}`;
        const client = createSatelliteClient();
        client.on('error', error => console.error(`[music][${label}] client error:`, error));

        try {
            await client.login(tokens[index]);

            const duplicateIdentity = listMusicEntries().find(entry => entry.client.user?.id === client.user?.id);
            if (duplicateIdentity) {
                console.error(`[music] Bo qua ${label}: cung Discord bot voi ${duplicateIdentity.label}; moi loa phai dung application/token rieng.`);
                await client.destroy().catch(() => {});
                continue;
            }

            const entry = registerMusicClient({ client, key: `satellite-${index + 1}`, label, role: 'satellite' });
            if (!entry) {
                await client.destroy().catch(() => {});
                continue;
            }
            attachMusicEntryEvents(entry);
            await initLavalink(client);
            console.log(`[music] ${label} online: ${client.user?.tag}`);
            started++;
        } catch (error: any) {
            console.error(`[music] ${label} login thất bại (token sai hoặc bot chưa được mời vào server?):`, error?.message || error);
            unregisterMusicClient(client);
            client.destroy().catch(() => {});
        }
    }
    return started;
}
