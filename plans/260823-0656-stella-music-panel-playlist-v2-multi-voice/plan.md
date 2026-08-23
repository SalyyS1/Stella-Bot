# Stella Music v2 — Panel Đẹp, Playlist Cá Nhân, Multi-Voice

Ngày: 2026-08-23
Trạng thái: IN PROGRESS
Branch: main

## Mục Tiêu

Nâng music từ "phát được" lên "dùng vui + đẹp + nhiều người dùng song song":

1. Panel now-playing đẹp (hybrid canvas card + embed GIF), chỉ hiện tên bài, không hiện URL thô.
2. Playlist cá nhân v2: nhiều playlist/user, tên + ảnh bìa tự đặt, share cho người khác.
3. Chất lượng audio cao hơn + chặn quảng cáo/sponsor + docs setup Spotify.
4. Phát song song nhiều kênh voice trong cùng server bằng satellite bot tokens.

## Quyết Định Đã Chốt (user, 2026-08-23)

| Vấn đề | Chốt |
|---|---|
| Phát 2 kênh voice cùng lúc | Satellite bot tokens (nhiều Discord app, chung 1 Lavalink + 1 DB) |
| Panel | Hybrid: canvas card khi đổi bài, embed + GIF cho update nhẹ |
| GIF | Dùng trực tiếp link pinimg, có fallback ẩn ảnh nếu lỗi |
| Scope đợt đầu | Cả 4 nhóm: panel/UX, playlist v2, quality + ad-block, satellite |

## Ràng Buộc Kỹ Thuật Quan Trọng

- **1 bot token = 1 voice channel / 1 guild.** Discord chỉ cho mỗi bot user một voice state trong một guild. Muốn phát 2 bài ở 2 kênh voice cùng server thì **bắt buộc** thêm bot application khác. Không có cách nào lách bằng code.
- Nhiều bot client **dùng chung 1 Lavalink node được** (mỗi client mở session riêng theo User-Id).
- `musicManager.ts` đang 416 dòng và sẽ phình to → phải modularize trước khi thêm feature (rule 200 LOC).
- Player hiện tại key theo `guildId` (`getPlayer(client, guildId)`). Multi-voice cần key theo `guildId + voiceChannelId` + biết player đó thuộc client nào.

## Phases

| # | Phase | File | Phụ thuộc |
|---|---|---|---|
| 1 | Modularize + session-ready core | [phase-01-modularize-music-core.md](phase-01-modularize-music-core.md) | — |
| 2 | Panel hybrid + UX (card, select, pagination) | [phase-02-panel-hybrid-va-ux.md](phase-02-panel-hybrid-va-ux.md) | P1 |
| 3 | Playlist v2 (multi, ảnh bìa, share) | [phase-03-playlist-v2.md](phase-03-playlist-v2.md) | P1 |
| 4 | Audio quality + ad-block + Spotify docs | [phase-04-audio-quality-adblock-spotify.md](phase-04-audio-quality-adblock-spotify.md) | — |
| 5 | Satellite bots multi-voice | [phase-05-satellite-multi-voice.md](phase-05-satellite-multi-voice.md) | P1, P2 |

P4 độc lập (chỉ sửa yml + docs) nên có thể làm song song / làm trước để test nghe thử ngay.

## Acceptance Criteria

- `npm run build` (tsc) pass sau mỗi phase; `npm test` (self-check) pass.
- Panel không hiện URL thô, tên bài là masked link, có progress bar + ảnh bìa + GIF.
- `/music search` trả select menu, chọn 1 dòng là phát đúng bài đó.
- `/music queue` phân trang, select menu nhảy tới bài bất kỳ trong 25 bài đầu trang.
- User tạo được ≥2 playlist, đặt ảnh bìa, share code cho người khác play/copy được.
- Playlist cũ (`MusicPlaylistTrack`) không mất dữ liệu sau migration.
- Với ≥1 satellite token: 2 người ở 2 kênh voice khác nhau cùng server phát 2 bài khác nhau, panel/nút của bot chính điều khiển đúng session của mình.
- Không có satellite token: hành vi y như cũ (1 kênh), báo lỗi rõ ràng khi kênh khác xin nhạc.

## Rollback

- P1-P3, P5: revert commit, không có state ngoài DB ngoại trừ migration P3.
- P3 migration: backfill là `INSERT ... SELECT`, giữ bảng cũ tới khi verify xong mới drop ở migration sau.
- P4: revert `lavalink/application.yml` + `lavalink-host/application.yml`, restart Lavalink.
