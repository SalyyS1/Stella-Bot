// ============================================================
//  MUSIC AUDIO CONFIG — cac nguong am thanh dung chung
// ============================================================
// LavalinkManager dang dat volumeDecrementer = 0.75, nghia la so nguoi dung
// thay se duoc nhan 0.75 truoc khi gui xuong Lavalink (100 -> 75 that).
// Vi vay tran 150 = 112 that, du to ma chua re. Khong nang decrementer len 1.0
// vi nhac dang phat se to hon 33% dot ngot cho ca voice channel.

export const MIN_VOLUME = 10;
export const MAX_VOLUME = 150;
export const DEFAULT_VOLUME = 100;
/** Tren muc nay thi canh bao nguoi dung co the bi re tieng. */
export const LOUD_VOLUME_WARNING = 130;
export const SEEK_STEP_MS = 10_000;

// ============================================================
//  SPONSORBLOCK
// ============================================================
// Bo doan sponsor/tu quang cao/intro/outro ngay trong video YouTube.
// Bo "filler" vi no hay cat luon phan nguoi ta muon nghe.
// Can plugin sponsorblock tren Lavalink; neu node khong co plugin thi lenh
// setSponsorBlock se loi va bi bo qua (khong lam chet player).
export const SPONSORBLOCK_CATEGORIES = [
    'sponsor',
    'selfpromo',
    'interaction',
    'intro',
    'outro',
    'preview',
    'music_offtopic'
] as const;

export function sponsorBlockEnabled() {
    return process.env.MUSIC_SPONSORBLOCK !== '0';
}
