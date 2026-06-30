# Roadmap Music Cho Stella Bot

Ngày research: 2026-06-30

## Nguồn Đã Tham Khảo

- Lavalink: https://github.com/lavalink-devs/Lavalink
- Lavalink plugin list/docs: https://lavalink.dev/plugins.html
- lavalink-client: https://github.com/Tomato6966/lavalink-client
- LavaSrc: https://github.com/topi314/LavaSrc
- YouTube source plugin: https://github.com/lavalink-devs/youtube-source
- Discord MusicBot public repo để tham khảo UX/feature, không copy code: https://github.com/SudhanPlayz/Discord-MusicBot

## Kết Luận Nhanh

Stella nên giữ kiến trúc **Discord bot + Lavalink node riêng**. Đây là hướng hợp lý nhất cho hosting vì bot Node.js chỉ điều khiển queue/player, còn decode/stream audio nằm ở Lavalink.

Không nên cố phát nhạc trực tiếp trong bot bằng thư viện download audio rời rạc. Dễ gãy vì YouTube thay đổi, tốn CPU hosting, và khó hỗ trợ Spotify/SoundCloud/playlist.

## Ưu Tiên Sửa Nền

1. **Remote Lavalink node**
   - Đã hỗ trợ `LAVALINK_NODES` dạng JSON.
   - Cần dùng `/music health` để debug trên hosting.

2. **Queue ổn định**
   - Playlist user tối đa 20 bài không được bị cooldown tự chặn.
   - Khi queue nhiều bài, cần báo rõ số bài add thành công/thất bại.

3. **Không spam XP/Scoin**
   - Prefix music không cộng XP/Scoin.
   - Play/search có cooldown riêng.

4. **Error thân thiện**
   - Node offline, track unavailable, region blocked, playlist quá dài phải trả lỗi dễ hiểu.

## Feature Nên Làm Tiếp

### 1. Search Select

Command:

```text
/music search query:...
s!search <query>
```

Bot trả 5 kết quả bằng select menu:

- title
- duration
- source
- requester

Lý do: user Discord hay search sai tên bài. Select menu giảm queue nhầm.

### 2. Vote Skip

Nếu voice channel có nhiều người:

- Admin/DJ skip ngay.
- User thường cần 50-60% người nghe vote skip.
- Người không cùng voice không vote được.

Lý do: server community đông, tránh một người phá nhạc.

### 3. DJ Role / Music Permission

Config:

- role DJ được stop/skip/clear/volume.
- user thường chỉ play/queue/voteskip.
- host queue có quyền ưu tiên với bài mình add.

Lý do: giảm abuse mà vẫn vui.

### 4. Queue Pagination

Queue embed chia trang:

- 10 bài/trang
- button prev/next
- current track luôn pinned ở đầu

Lý do: queue dài đọc không nổi nếu nhét một embed.

### 5. Save Current To Playlist

Command:

```text
/music playlist save-current
s!save
```

Lưu bài đang phát vào playlist cá nhân nếu chưa đủ 20 bài.

Lý do: thao tác tự nhiên hơn nhập title + uri thủ công.

### 6. Favorites + Recently Played

DB:

- `MusicPlayHistory`
- `MusicFavoriteTrack`

Feature:

- `/music recent`
- `/music favorite add/remove/play`
- gợi ý bài từ lịch sử nghe

Lý do: community có gu nhạc lặp lại, bot nên nhớ giúp.

### 7. Filters

Filter an toàn:

- bassboost
- nightcore
- vaporwave
- karaoke
- clear

Command:

```text
/music filter preset:bassboost
```

Lý do: vui, nhưng phải giới hạn preset để khỏi phá tai cả voice.

### 8. Lyrics

Tùy chọn:

- tìm lyrics bằng provider public/API riêng.
- trả paginated embed.

Cảnh báo: lyrics có vấn đề bản quyền/API quota, nên để phase sau.

### 9. 24/7 Mode Theo Guild

Guild setting:

- auto leave khi queue hết: default on
- 24/7 mode: bot ở lại voice

Chỉ admin/DJ bật được.

### 10. Stage/Radio Mode

Một channel text làm “music booth”:

- panel cố định
- now playing auto update
- queue request qua button/modal

Lý do: hợp server community, tránh spam lệnh trong chat chính.

## Feature Không Nên Làm Vội

- Download mp3/video về host: dễ tốn disk/băng thông, rủi ro policy.
- Auto DJ từ YouTube liên tục: dễ đụng rate/nguồn không ổn định.
- Lyrics ngay phase đầu: dễ lệch trọng tâm.
- Multi-bot/sharding music nếu server chưa đủ lớn.

## Plan Implement Đề Xuất

### Phase 1 - Stabilize

- `/music health`
- `LAVALINK_NODES`
- fix playlist cooldown
- docs hosting + remote Lavalink

### Phase 2 - UX

- search select
- queue pagination
- save-current
- better now-playing panel

### Phase 3 - Control

- DJ role
- vote skip
- per-guild music settings
- anti-abuse per command

### Phase 4 - Fun

- filters
- favorites/recently played
- radio panel

### Phase 5 - Advanced

- lyrics
- scheduled radio events
- Scoin music perks, ví dụ đổi màu panel/queue priority nhỏ
