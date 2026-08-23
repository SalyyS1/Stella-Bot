// ============================================================
//  MUSIC MODULE — public API cho events/commands
// ============================================================
// Chia nho theo concern: pool bot client, router session, queue service,
// panel, playlist, handler slash/prefix/component.

export { initLavalink, listMusicEntries } from './music-client-pool';
export type { MusicClientEntry } from './music-client-pool';
export { setupLavalink } from './music-bootstrap';
export { startSatelliteMusicBots } from './music-satellite-bootstrap';
export { MAX_VOLUME, MIN_VOLUME } from './music-audio-config';
export { applyMusicFilter, MUSIC_FILTER_PRESETS } from './music-filter-service';
export { formatDuration, trackInfo } from './music-format';
export { getMusicPrefix, lavalinkConfigured } from './music-node-config';
export { buildMusicPanel, musicHealthPanel, musicPanel, musicPanelForSession } from './music-panel';
export { rememberPanelMessage } from './music-panel-message';
export {
    autocompleteMusicPlaylistName,
    handleMusicPlaylistImport,
    handleMusicPlaylistSlash
} from './music-playlist-commands';
export { handleMusicPrefix } from './music-prefix-commands';
export { controlMusic, queueTrack, setMusicVolume } from './music-queue-service';
export { findSessionsInGuild, resolveControllableSession } from './music-session-router';
export type { MusicSession } from './music-session-router';
export { executeMusicSlash, handleMusicComponent } from './music-slash-handlers';
