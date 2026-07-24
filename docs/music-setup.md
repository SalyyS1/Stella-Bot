# Setup Music Cho Stella Bot

Music của Stella dùng Lavalink v4. Bot sẽ không phát nhạc nếu thiếu `LAVALINK_*` trong `.env` hoặc Lavalink chưa chạy.

## Chọn Kiểu Chạy

- **Máy local/VPS có Docker:** chạy Lavalink bằng `docker-compose.lavalink.yml`.
- **Hosting Node.js/shared hosting:** bot chỉ chạy Node.js, còn Lavalink nên dùng node remote riêng. Hosting thường không chạy được Docker/Java service ổn định.

Nếu dùng hosting, ưu tiên cấu hình `LAVALINK_NODES` hoặc `LAVALINK_HOST/LAVALINK_PORT/LAVALINK_PASSWORD` trỏ đến Lavalink remote.

## 1. Cấu Hình `.env`

Local Docker:

```env
MUSIC_PREFIX=s!
LAVALINK_HOST=127.0.0.1
LAVALINK_PORT=2333
LAVALINK_PASSWORD=doi_password_dai_ngau_nhien
LAVALINK_SECURE=false
```

Remote/hosting:

```env
MUSIC_PREFIX=s!
LAVALINK_NODES=[{"id":"Remote Main","host":"your-lavalink-host.com","port":443,"authorization":"your-password","secure":true}]
```

`LAVALINK_NODES` cho phép nhiều node. Nếu có biến này, bot sẽ bỏ qua `LAVALINK_HOST/LAVALINK_PORT`. Password là bắt buộc và phải trùng `LAVALINK_SERVER_PASSWORD` của node; không dùng giá trị mẫu hay để trống.

Nếu muốn Spotify playlist/album/track ổn hơn, tạo app tại Spotify Developer Dashboard rồi thêm:

```env
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
```

Không có Spotify key thì YouTube/YouTube Music search và SoundCloud vẫn dùng được.

## 2. Chạy Lavalink Local Bằng Docker

Tại thư mục repo:

```powershell
docker compose -f docker-compose.lavalink.yml up -d
```

Xem log:

```powershell
docker logs -f stella-lavalink
```

Khi thấy Lavalink started/listening port `2333` là ổn.

## 3. Restart Bot

```powershell
npm run build
npm start
```

Log bot nên có dòng Lavalink connected. Nếu còn thấy `Lavalink env is missing`, kiểm tra lại `.env` và restart bot.

Kiểm tra nhanh:

```text
/music health
s!health
```

Health check chỉ hiện node/host/port, không hiện password.

## 4. Cách Dùng

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

Khi Stella đã phát nhạc, người dùng phải ở **cùng voice channel với Stella** mới điều khiển được player, gồm các thao tác như queue, skip và stop. Nếu Stella đang ở channel khác, hãy vào đúng channel đó trước.

## Lưu Ý Cho Hosting

- Không upload `.env` lên GitHub. Tạo `.env` trực tiếp trong file manager/SFTP hoặc biến môi trường của panel.
- Nếu hosting không có Java/Docker, không chạy Lavalink trên cùng hosting. Dùng node Lavalink remote.
- Cần chạy `npm install`, `npm run build`, `npm start`.
- Nếu dùng database cloud, chạy `npm run db:migrate` trước lần start chính thức.
- Nếu upload bản zip, đừng upload `node_modules`, `dist.zip`, backup DB, log cũ.

## Lỗi Thường Gặp

- Bot không vào voice: kiểm tra bot có quyền `Connect`, `Speak`, `Use Voice Activity`.
- Không điều khiển được nhạc: kiểm tra bạn có đang ở cùng voice channel với Stella không.
- Không search được YouTube: xem log `stella-lavalink`, plugin YouTube có tải thành công không.
- Spotify không chạy: cần `SPOTIFY_CLIENT_ID` và `SPOTIFY_CLIENT_SECRET`, rồi chạy lại container Lavalink.
- Port 2333 bị chiếm: đổi port trong `docker-compose.lavalink.yml` và `.env`.
- Trên hosting `/music health` có node nhưng không play: kiểm tra firewall outbound tới Lavalink remote và password node.
