# Setup Music Cho Stella Bot

Music của Stella dùng Lavalink v4. Bot sẽ không phát nhạc nếu thiếu `LAVALINK_*` trong `.env` hoặc Lavalink chưa chạy.

## 1. Cài Docker

Cài Docker Desktop rồi mở Docker cho tới khi trạng thái là running.

## 2. Kiểm tra `.env`

Trong `.env`, cần có các dòng này:

```env
MUSIC_PREFIX=s!
LAVALINK_HOST=127.0.0.1
LAVALINK_PORT=2333
LAVALINK_PASSWORD=stella_lavalink_password
LAVALINK_SECURE=false
```

Nếu muốn Spotify playlist/album/track ổn hơn, tạo app tại Spotify Developer Dashboard rồi thêm:

```env
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
```

Không có Spotify key thì YouTube/YouTube Music search và SoundCloud vẫn dùng được.

## 3. Chạy Lavalink

Tại thư mục repo:

```powershell
docker compose -f docker-compose.lavalink.yml up -d
```

Xem log:

```powershell
docker logs -f stella-lavalink
```

Khi thấy Lavalink started/listening port `2333` là ổn.

## 4. Restart bot

```powershell
npm run build
npm start
```

Log bot nên có dòng Lavalink connected. Nếu còn thấy `Lavalink env is missing`, kiểm tra lại `.env` và restart bot.

## 5. Cách dùng

Vào voice channel trước, rồi dùng:

```text
s!play tên bài hoặc link
s!queue
s!skip
s!stop
```

Slash command:

```text
/music play query:...
/music queue
/music playlist add
```

Playlist cá nhân giới hạn 20 bài/người.

## Lỗi Thường Gặp

- Bot không vào voice: kiểm tra bot có quyền `Connect`, `Speak`, `Use Voice Activity`.
- Không search được YouTube: xem log `stella-lavalink`, plugin YouTube có tải thành công không.
- Spotify không chạy: cần `SPOTIFY_CLIENT_ID` và `SPOTIFY_CLIENT_SECRET`, rồi chạy lại container Lavalink.
- Port 2333 bị chiếm: đổi port trong `docker-compose.lavalink.yml` và `.env`.
