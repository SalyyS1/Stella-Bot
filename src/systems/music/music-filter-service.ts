import { GuildMember } from 'discord.js';
import { resolveControllableSession } from './music-session-router';

// ============================================================
//  MUSIC FILTER SERVICE — preset an toan cho ca voice channel
// ============================================================
// Chi mo allowlist preset, khong cho user gui filter tho: filter chay tren
// Lavalink nen cau hinh sai vua pha tai vua ton CPU node.

export const MUSIC_FILTER_PRESETS = ['bassboost', 'nightcore', 'vaporwave', 'karaoke', '8d', 'clear'] as const;
export type MusicFilterPreset = typeof MUSIC_FILTER_PRESETS[number];

const FILTER_LABELS: Record<MusicFilterPreset, string> = {
    bassboost: 'Bassboost',
    nightcore: 'Nightcore',
    vaporwave: 'Vaporwave',
    karaoke: 'Karaoke (giảm giọng hát)',
    '8d': '8D (âm thanh xoay)',
    clear: 'Tắt hết filter'
};

const FILTER_COOLDOWN_MS = 5_000;
const filterCooldown = new Map<string, number>();

export function isMusicFilterPreset(value: string): value is MusicFilterPreset {
    return (MUSIC_FILTER_PRESETS as readonly string[]).includes(value);
}

function checkFilterCooldown(guildId: string) {
    const now = Date.now();
    for (const [id, expiresAt] of filterCooldown) {
        if (expiresAt <= now) filterCooldown.delete(id);
    }
    if ((filterCooldown.get(guildId) || 0) > now) throw new Error('Đổi filter nhanh quá, chờ vài giây rồi thử lại.');
    filterCooldown.set(guildId, now + FILTER_COOLDOWN_MS);
}

export async function applyMusicFilter(member: GuildMember | null, preset: string) {
    if (!isMusicFilterPreset(preset)) throw new Error(`Filter không hợp lệ. Chọn: ${MUSIC_FILTER_PRESETS.join(', ')}.`);

    const session = resolveControllableSession(member);
    checkFilterCooldown(session.guildId);
    const filters = session.player.filterManager;

    if (preset === 'clear') {
        await filters.resetFilters();
        await filters.clearEQ();
    }
    // lavalink-client khong co toggleBassboost — bassboost lam bang EQ preset.
    if (preset === 'bassboost') await filters.setEQPreset('BassboostMedium');
    if (preset === 'nightcore') await filters.toggleNightcore();
    if (preset === 'vaporwave') await filters.toggleVaporwave();
    if (preset === 'karaoke') await filters.toggleKaraoke();
    if (preset === '8d') await filters.toggleRotation();

    return { session, label: FILTER_LABELS[preset] };
}
