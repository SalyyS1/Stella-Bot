import { ChannelType } from 'discord.js';
import { getMainMusicEntry } from './music-client-pool';

// ============================================================
//  MUSIC PANEL LAYOUT — panel gon cho chat trong kenh voice
// ============================================================
// Chat cua kenh voice hien o cot hep ben phai client Discord, khong rong bang
// text channel thuong. Cung mot card 1000px o cot hep se bi thu nho lai nen
// chu gan nhu khong doc duoc. Vi vay panel co 2 khuon:
//
//   wide    - text channel binh thuong: card ngang, nut co chu.
//   compact - chat trong kenh voice: card gon (ty le cao hon nen khi thu nho
//             chu con lon), nut chi con icon, danh sach bai ke tiep ngan hon.

export type PanelLayout = 'wide' | 'compact';

/** Gioi han chu cho tung khuon — cot hep thi ten dai lam vo dong. */
export const PANEL_TEXT_LIMITS: Record<PanelLayout, { nextTitle: number; nextCount: number; selectLabel: number }> = {
    wide: { nextTitle: 58, nextCount: 3, selectLabel: 100 },
    compact: { nextTitle: 34, nextCount: 2, selectLabel: 64 }
};

/**
 * Kenh voice trong discord.js v14 la text-based: gui tin nhan vao day thi no
 * hien trong "chat voice". Do la dau hieu duy nhat dang tin de biet panel dang
 * nam o cot hep.
 */
export function resolvePanelLayout(channelId?: string | null): PanelLayout {
    if (!channelId) return 'wide';
    const channel = getMainMusicEntry()?.client?.channels?.cache?.get(channelId);
    if (!channel) return 'wide';
    return channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice ? 'compact' : 'wide';
}

/** Layout cua panel thuoc ve kenh ma player dang bao tin nhan vao. */
export function layoutForPlayer(player: any): PanelLayout {
    return resolvePanelLayout(player?.textChannelId ? String(player.textChannelId) : null);
}
