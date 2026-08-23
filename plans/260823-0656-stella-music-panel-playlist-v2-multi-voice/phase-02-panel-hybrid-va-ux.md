# Phase 02 — Panel Hybrid + UX Nghe Nhạc

Trạng thái: TODO
Phụ thuộc: P1
Mục tiêu: panel now-playing đẹp (canvas card + embed GIF), chỉ hiện tên bài, thêm search select, queue phân trang + chọn bài để phát, seek/volume bằng nút.

## Thiết Kế Panel

Một message panel / session, lưu `panelMessageId + textChannelId` trong session state.

- **Đổi bài (trackStart)**: render canvas card mới → `edit({ attachments: [], files: [card], embeds, components })`.
- **Update nhẹ** (pause/skip/vol/loop/seek/refresh): `edit({ embeds, components })` **không truyền `files`/`attachments`** → Discord giữ ảnh card cũ, chỉ text đổi (embed có progress bar mới).
- Nếu panel không còn là message cuối kênh (đã bị chat đè) hoặc edit fail → xóa panel cũ, gửi panel mới.
- Không dùng timer auto-refresh progress bar (tránh rate limit); có nút `🔄` refresh thủ công.

### Embed

- Title: `Đang phát` / `Queue trống`.
- Description: `[Tên bài](uri)` masked link + dòng `Artist • Nguồn` + progress bar text `▬▬▬🔘▬▬▬ 1:23 / 4:56`. **Không in URL thô ở bất kỳ đâu.**
- Fields inline: `Queue` (n bài), `Loop`, `Volume`, `Người yêu cầu`, `Kênh voice`.
- `setThumbnail(MUSIC_PANEL_GIF)` — GIF pinimg (`https://i.pinimg.com/originals/c8/4f/b7/c84fb740471d58ba9597ace28969d490.gif`), khai báo trong `src/config.ts` (`config.music.panelGif`) để đổi nhanh. Nếu Discord không load được thì thumbnail tự ẩn, panel vẫn chạy.
- `setImage('attachment://stella-now-playing.png')` — canvas card.
- Color: lấy màu accent theo nguồn (YouTube đỏ, Spotify xanh, SoundCloud cam) cho dễ nhìn.

### Canvas Card (`music-now-playing-card.ts`)

Kích thước 1000x300, style bám theo `cardRenderer.ts` (`roundRect`, `drawAvatar`, font `Noto Sans` qua `registerFonts()` của `newspaper-fonts.ts`).

- Background: `track.info.artworkUrl` vẽ cover toàn card **nhưng** downscale xuống canvas tạm 40x12 rồi upscale với `imageSmoothingEnabled = true` → hiệu ứng mờ, khỏi cần thư viện blur. Overlay gradient đen `rgba(0,0,0,0.55 → 0.85)`.
- Ảnh bìa vuông bo góc 220x220 bên trái.
- Tên bài (bold 40px, cắt bằng `truncate` theo pixel width), artist (24px xám), nguồn + duration.
- Progress bar vẽ thật (roundRect nền + roundRect fill theo `player.position / track.info.duration`) + mốc thời gian 2 đầu.
- Avatar người request (dùng `drawAvatar`) góc phải + tên.
- Fallback: không có artwork → gradient theo hash tên bài, không throw.
- Cache: `Map<trackIdentifier, Buffer>` LRU nhỏ (≤20) để pause/resume/skip qua lại không render lại.

### Components (4 rows)

| Row | Nội dung |
|---|---|
| 1 | `⏯ Pause/Resume`, `⏭ Skip`, `⏹ Stop`, `🔁 Loop (off→track→queue)`, `🔀 Shuffle` |
| 2 | `🔉 -10%`, `🔊 +10%`, `⏪ -10s`, `⏩ +10s`, `🔄 Refresh` |
| 3 | `💾 Lưu vào playlist`, `📜 Queue`, `🎚 Filter`, `📤 Ngắt kết nối` |
| 4 | StringSelect `Chọn bài để phát ngay` (chỉ hiện khi queue có bài) |

- Custom id: `music:<action>:<arg?>` — **đổi separator sang `:`** vì `interactionCreate.ts` đang `split('_')` và các action mới có 2 từ (`vol_up`). Parse trong `handleMusicComponent`, `interactionCreate` chỉ cần `customId.startsWith('music:')`. Giữ thêm nhánh tương thích cho `music_*` cũ trong 1 phase để panel cũ trong lịch sử chat không chết.
- Quyền: nút phá nhạc (Stop/Skip/Disconnect/Filter) yêu cầu cùng voice channel với session (dùng `resolveControllableSession`); người ngoài voice bấm → ephemeral từ chối.

## Search Select

- `/music search query:` và `s!search <query>` → lấy 10 kết quả đầu, embed list `1. Tên bài — artist (3:45)` (không URL) + StringSelect.
- Select option value **không** được là encoded track (dài > 100 ký tự giới hạn Discord) → cache `Map<searchId, { tracks, userId, guildId, expiresAt }>`, TTL 5 phút, value = `<searchId>:<index>`, dọn map bằng lazy sweep như `playCooldown`.
- Chỉ người gọi search mới chọn được (check `userId`), người khác bấm → ephemeral "search này của người khác".

## Queue Pagination + Jump

- `/music queue page:` + nút `◀ ▶`: 10 bài/trang, bài đang phát pin ở đầu, hiện tổng thời lượng còn lại.
- StringSelect jump: 25 bài đầu của trang hiện tại, value = index tuyệt đối trong queue; chọn → `player.queue.splice(index, 1)` lấy track đó rồi `player.play({ clientTrack })` (bỏ các bài trước? **không** — chỉ nhảy tới bài đó, giữ phần còn lại).
- Nút jump chỉ dành cho DJ/người request bài đó/người cùng voice (P1 giữ đơn giản: cùng voice là được).

## Files

- Mới: `src/systems/music/music-now-playing-card.ts`, `music-panel-components.ts`, `music-search-cache.ts`, `music-queue-view.ts`.
- Sửa: `music-panel.ts` (hybrid orchestration), `music-queue-service.ts` (thêm `seek`, `jumpToQueueIndex`, `searchTracks`, `setLoopMode`), `music-slash-handlers.ts` (route select + button mới), `music-prefix-commands.ts` (`s!search`, `s!seek`, `s!nowplaying`), `src/commands/music.ts` (thêm subcommand `search`, `seek`, option `page` cho queue), `src/config.ts` (`config.music`), `src/events/interactionCreate.ts` (delegate `music:` prefix, thêm nhánh select menu music).
- Panel state: `music-session-router.ts` giữ thêm `panelMessageId`, `panelChannelId`, `lastCardTrackId`.
- Event `trackStart` trong `music-client-pool.ts` → gọi `refreshPanel(session, { newTrack: true })`.

## Validation

```powershell
npm run build
npm test
```

Smoke (cần Lavalink):

1. `s!play lofi` → panel có card + GIF + progress bar, không có URL thô.
2. Bấm Vol+/-, ⏪/⏩, Loop 3 trạng thái, Refresh → embed đổi, ảnh card không mất.
3. `/music search` chọn dòng 3 → phát đúng bài đó.
4. Queue ≥12 bài → phân trang, select nhảy bài đúng.
5. Người ngoài voice bấm Stop → bị từ chối ephemeral.

## Risks

- **Rate limit**: mỗi lần bấm nút là 1 edit. Không thêm interval refresh. Nếu spam nút, cooldown 1s/user/session cho các nút thay đổi state.
- **Canvas chậm**: render ~200-400ms. Chỉ render khi đổi bài + có cache; nút nhẹ không render.
- `player.position` chỉ chính xác theo `playerUpdateInterval: 5` (5s) → progress bar lệch tối đa 5s, chấp nhận được; ghi rõ trong code comment.
- Select option limit 25, label limit 100 ký tự → phải `truncate`.
- Artwork URL của một số nguồn (SoundCloud) có thể 404 → `loadImage` phải try/catch (giống `drawAvatar`).
