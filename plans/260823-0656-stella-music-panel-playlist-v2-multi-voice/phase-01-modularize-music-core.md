# Phase 01 — Modularize Music Core (Session-Ready)

Trạng thái: TODO
Phụ thuộc: —
Mục tiêu: tách `src/systems/musicManager.ts` (416 dòng) thành module nhỏ và đổi cách tra player từ "1 player / guild" sang "session theo guild + voice channel + client", **không đổi hành vi người dùng**.

## Lý Do

- Rule 200 LOC: P2-P5 sẽ thêm canvas card, select menu, playlist v2, satellite pool → file hiện tại sẽ vượt 1000 dòng.
- P5 (satellite) cần biết "player này thuộc bot client nào", `getPlayer(client, guildId)` hiện tại không diễn tả được.
- `events/interactionCreate.ts` đã dài; component handler music nên nằm trong module music.

## Files

Tạo mới trong `src/systems/music/`:

| File | Nội dung |
|---|---|
| `music-node-config.ts` | `parseBoolean`, `normalizeNode`, `getLavalinkNodes`, `lavalinkConfigured`, hằng số retry (`NODE_RETRY_AMOUNT`, `NODE_RETRY_DELAY_MS`), `MUSIC_PREFIX` |
| `music-client-pool.ts` | `setupLavalink(client)`, `initLavalink(client)`, `sendLavalinkRaw(client, payload)`, registry `MusicClientEntry { key, label, role: 'main' \| 'satellite', client, lavalink }`, `getMainEntry()`, `listEntries()` |
| `music-session-router.ts` | `MusicSession { entry, player, guildId, voiceChannelId }`, `findSessionByVoiceChannel()`, `findSessionsInGuild()`, `resolveControllableSession(member)`, `acquireSessionForMember(member, textChannelId)` (P1: chỉ dùng main entry) |
| `music-queue-service.ts` | `ensureVoice`, cooldown, `queueTrack`, `searchTracks`, `controlMusic`, `setVolume` |
| `music-playlist-service.ts` | `addPlaylistTrack`, `removePlaylistTrack`, `clearPlaylist`, `getPlaylist`, `playPlaylist` (giữ nguyên logic, P3 mở rộng) |
| `music-panel.ts` | `musicPanel`, `musicHealthPanel` (giữ nguyên format, P2 làm đẹp) |
| `music-format.ts` | `formatDuration`, `truncate`, `trackTitle` (dùng lại cho panel/queue/playlist) |
| `music-prefix-commands.ts` | `handleMusicPrefix` |
| `music-slash-handlers.ts` | `executeMusicSlash`, `handleMusicComponent(interaction)` (mới, gom logic button music) |
| `index.ts` | barrel export đúng public API đang dùng |

Sửa import (đổi `../systems/musicManager` → `../systems/music`):

- `src/index.ts` (`setupLavalink`, `sendLavalinkRaw`)
- `src/events/ready.ts` (`initLavalink`)
- `src/events/messageCreate.ts` (`handleMusicPrefix`)
- `src/events/interactionCreate.ts` (`controlMusic`, `musicPanel` → thay bằng `handleMusicComponent`)
- `src/commands/music.ts` (playlist + `executeMusicSlash`)

Xóa: `src/systems/musicManager.ts` (sau khi mọi import đã chuyển).

## Steps

1. Tạo `music-node-config.ts` + `music-format.ts` (thuần hàm, không phụ thuộc gì).
2. Tạo `music-client-pool.ts`: chuyển `setupLavalink/initLavalink/sendLavalinkRaw`; thêm registry entry cho main client. `setupLavalink` vẫn `console.warn` khi thiếu env như hiện tại.
3. Tạo `music-session-router.ts`. P1 chỉ có main entry nên `acquireSessionForMember` = logic cũ (`createPlayer` + check `voiceChannelId` khác thì throw). Giữ y nguyên message lỗi tiếng Việt hiện có để không phá UX.
4. Tạo `music-queue-service.ts`, `music-playlist-service.ts`, `music-panel.ts`, `music-prefix-commands.ts`, `music-slash-handlers.ts` bằng cách bê code cũ, chỉ đổi chỗ gọi sang session router.
5. `handleMusicComponent(interaction)`: nhận `ButtonInteraction`, tự `deferUpdate`, gọi `controlMusic`, `editReply(musicPanel)`; trả `boolean` đã xử lý hay chưa. `interactionCreate.ts` chỉ còn `if (action === 'music') return handleMusicComponent(interaction);`.
6. Cập nhật 5 import site, xóa file cũ.

## Validation

```powershell
npm run build
npm test
```

- Grep chắc chắn không còn `systems/musicManager`.
- Smoke thủ công (nếu có Lavalink chạy): `s!play <bài>`, nút Pause/Skip/Stop, `/music health`, `/music playlist view`.

## Risks

- Đứt import ẩn: check bằng `tsc` (strict) + grep.
- `client.lavalink` được gán qua `(client as any).lavalink` và `declare module 'discord.js'` ở `index.ts` — giữ nguyên field này để không phá code khác đọc `client.lavalink`.
- Đừng đổi custom_id button (`music_pause`...) ở phase này để panel cũ đang hiển thị trong Discord vẫn bấm được.
