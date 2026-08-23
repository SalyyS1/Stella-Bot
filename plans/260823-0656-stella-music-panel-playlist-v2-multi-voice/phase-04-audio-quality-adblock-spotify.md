# Phase 04 — Chất Lượng Audio + Chặn Quảng Cáo + Docs Spotify

Trạng thái: TODO
Phụ thuộc: — (độc lập, chỉ sửa yml + docs + 1 ít code filter)
Mục tiêu: nghe hay hơn thật sự (không phải placebo), bỏ đoạn quảng cáo/sponsor trong video, docs Spotify đúng chỗ.

## Sự Thật Cần Biết Trước (đã verify 2026-08-23)

- `opusEncodingQuality` **không phải bitrate**, nó map sang `OPUS_SET_COMPLEXITY` 0-10.
- Lavaplayer **không bao giờ gọi `OPUS_SET_BITRATE`** → libopus dùng `OPUS_AUTO` = `60*48000/960 + 48000*2` = **~99 kbps**. Nên set kênh voice Discord trên 128 kbps là vô nghĩa cho bot; 96-128 kbps là đủ. Nâng bitrate kênh lên 384 kbps không làm nhạc hay hơn.
- "Chặn quảng cáo" gồm 3 chuyện khác nhau:
  1. **Quảng cáo pre-roll/mid-roll của YouTube**: Lavalink stream trực tiếp audio track nên **vốn đã không có** — không cần làm gì.
  2. **Đoạn sponsor/tự quảng cáo trong chính video**: cần plugin **SponsorBlock**.
  3. **Quảng cáo Spotify**: không tồn tại, vì LavaSrc chỉ lấy metadata Spotify rồi phát audio từ YouTube.

## Thay Đổi `lavalink/application.yml` + `lavalink-host/application.yml`

| Key | Hiện tại (host) | Đổi thành | Lý do |
|---|---|---|---|
| `lavasrc-plugin` | 4.8.1 | **4.8.3** | 4.8.3 sửa Spotify playlist dùng endpoint `/items` thay `/tracks` — **app Spotify mới tạo bắt buộc phải có bản này** mới load được playlist |
| `opusEncodingQuality` | 5 (host) | **10** | complexity cao = encode sạch hơn, tốn CPU chút; local đang 10 rồi |
| `resamplingQuality` | LOW | **MEDIUM** | chỉ ảnh hưởng nguồn khác 48kHz; HIGH chỉ nên dùng khi < 5 player |
| `frameBufferDurationMs` | 2000 (host) | **4000** | ít giật khi mạng/GC hiccup, tốn RAM theo số player |
| `bufferDurationMs` | 400 | giữ 400 | nâng 800 chỉ khi log thấy GC pause |
| `nonAllocatingFrameBuffer` | (mặc định false) | giữ false | true làm volume/filter đổi không tức thời |
| plugin mới | — | `com.github.topi314.sponsorblock:sponsorblock-plugin:3.0.1` | bỏ đoạn sponsor |

SponsorBlock config:

```yaml
lavalink:
  plugins:
    - dependency: "com.github.topi314.sponsorblock:sponsorblock-plugin:3.0.1"
      repository: "https://maven.lavalink.dev/releases"
      snapshot: false
```

- Nếu maven 404 khi Lavalink start, thử `https://maven.topi.wtf/releases`. Kiểm tra ngay ở log lần start đầu.
- **Cảnh báo tuổi plugin**: 3.0.1 ra 2024-07-22, ~25 tháng không release mới, có 1 bug mở (`horizontalCardListRenderer`). Nó tương thích Lavalink v4 nhưng chưa test với youtube-source 1.18.2 + Lavalink 4.2.2 của mình → coi như thử nghiệm, phải có công tắc tắt nhanh.

## Code

### SponsorBlock (bot phía lavalink-client)

- Khi tạo player: `player.setSponsorBlock([...categories])`.
- Categories mặc định: `sponsor`, `selfpromo`, `interaction`, `intro`, `outro`, `preview`, `music_offtopic`. Bỏ `filler` (dễ cắt cả phần muốn nghe).
- Log/notify nhẹ khi `SegmentSkipped` (không spam: chỉ ghi log, không gửi tin nhắn).
- Env `MUSIC_SPONSORBLOCK=1|0` để tắt nếu plugin gây lỗi track load.

### Volume

- Hiện `volumeDecrementer: 0.75` → user set 100 thì Lavalink chỉ nhận 75. `setVolume(v)` của lavalink-client clamp 0-1000; `player.volume` là số user thấy, `player.lavalinkVolume` là số thật.
- Đổi: default 100, cho phép **0-150** (tức thật 0-112), nút ±10, cảnh báo khi > 130 ("có thể rè").
- Không nâng `volumeDecrementer` lên 1.0 vì nhạc đang nghe sẽ đột ngột to hơn 33% cho mọi người.

### Filters (`/music filter preset:`)

Dùng `player.filterManager` của lavalink-client v2:

| Preset | Gọi gì |
|---|---|
| `bassboost` | `setEQPreset('BassboostMedium')` — **không có `toggleBassboost`** |
| `nightcore` | `toggleNightcore()` |
| `vaporwave` | `toggleVaporwave()` |
| `karaoke` | `toggleKaraoke()` |
| `8d` | `toggleRotation()` |
| `clear` | `resetFilters()` + `clearEQ()` |

- Chỉ cho phép allowlist trên, không mở API filter thô cho user.
- Filter tốn CPU Lavalink → chỉ DJ/người cùng voice đổi được, cooldown 5s.

## Docs

`docs/music-setup.md` thêm/sửa:

1. **Spotify setup đầy đủ**: tạo app ở developer.spotify.com → Client ID/Secret → **đặt env ở nơi chạy Lavalink, KHÔNG phải .env của bot** (LavaSrc chạy trong Lavalink). Hiện docs đang hướng dẫn đặt vào `.env` bot → sai chỗ, phải sửa.
2. Nói rõ có Client ID/Secret là dùng được: `spsearch:`, track, album, playlist, artist top tracks. Chưa dùng được: `sprec:` (recommendations), playlist do Spotify tự sinh (Discover Weekly...), lyrics (cần cookie `spDc`).
3. Nói rõ Spotify là **nguồn metadata**, audio vẫn lấy từ YouTube qua `providers` → link Spotify vẫn phát được nhưng bài nào YouTube không có thì fail.
4. Không bật `preferPartnerApi: true` (bug LavaSrc #342: mỗi playlist bắn N request ISRC tuần tự → load rất chậm).
5. Bảng "chất lượng audio": giải thích ~99 kbps cap, khỏi ai đó đi boost server để mong nhạc hay hơn.
6. SponsorBlock: bật/tắt, categories, cách nhận biết bị cắt quá tay.

## Validation

- Restart Lavalink, log phải có `Found plugin sponsorblock`, không có exception khi load plugin.
- `/music health` vẫn xanh, `s!play` một video có sponsor → log `SegmentSkipped`.
- Phát 1 link Spotify playlist (app Spotify mới tạo) → load được (chứng minh 4.8.3 fix hoạt động).
- So sánh nghe thử trước/sau khi đổi opus/resampling trên cùng 1 bài.
- `npm run build` (chỉ code filter/volume đổi).

## Không Làm Ở Phase Này

- **Lyrics**: cần LavaLyrics 1.1.0 (interface) + provider (`dev.arbjerg:lavalink-lyrics` 1.6.6 cho Genius, hoặc LavaSrc `lyrics-sources`); Lavalink ≥ 4.0.8. lavalink-client v2 có `player.getCurrentLyrics()`, `subscribeLyrics()` + event `LyricsLine` (karaoke chạy chữ). Để phase sau vì cần thêm API key/cookie.
- Deezer/Tidal/Apple Music: cần key riêng, chưa cần.
