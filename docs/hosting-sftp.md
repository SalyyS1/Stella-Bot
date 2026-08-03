# Deploy Stella Bot Lên Hosting Qua SFTP

Tài liệu này dùng cho hosting Node.js/shared hosting. Không lưu hostname, username, password SFTP trong repo.

## Nguyên Tắc

- Source có thể upload qua SFTP, secret phải nằm trong `.env` trên hosting.
- Không commit hoặc upload nhầm `.env`, backup DB, log cũ, file zip deploy.
- Music cần Lavalink remote nếu hosting không hỗ trợ Docker/Java service chạy nền.
- Database nên là Postgres cloud hoặc provider bền hơn SQLite local.
- **Mọi mốc thời gian bot tính theo `config.maintenance.timezone` (Asia/Saigon), KHÔNG
  phụ thuộc timezone của host** — nhật báo 21h, bài tuần chủ nhật, lời nhắc đều quy
  về giờ Saigon bằng `Intl.DateTimeFormat` với `timeZone` chỉ định. Đặt `TZ` của host
  thế nào cũng được, bot không đọc.

## File Nên Upload

- `src/` (bao gồm `src/assets/` — font tiếng Việt nhúng sẵn, host không cần cài font)
- `prisma/` trừ file SQLite local
- `docs/` nếu muốn giữ hướng dẫn trên host
- `lavalink/` và `docker-compose.lavalink.yml` chỉ cần nếu host/VPS chạy được Docker
- `package.json`
- `package-lock.json`
- `tsconfig.json`

Không upload:

- `.env`
- `node_modules/`
- `dist/` nếu hosting tự build
- `*.zip`
- `backups/`
- `prisma/*.db`

## Setup Trên Hosting

1. Upload source qua SFTP.
2. Tạo `.env` trực tiếp trên hosting từ `.env.example`.
3. Chạy:

```bash
npm install
npm run build
npm run db:migrate
npm start
```

Nếu panel có mục startup command, dùng:

```bash
npm start
```

Nếu panel có build command, dùng:

```bash
npm install && npm run build && npm run db:migrate
```

## Music Trên Hosting

Shared hosting thường không nên chạy Lavalink cùng host. Dùng remote node:

```env
MUSIC_PREFIX=s!
LAVALINK_NODES=[{"id":"Remote Main","host":"lavalink.example.com","port":443,"authorization":"password","secure":true}]
```

Lavalink remote phải có địa chỉ và port mà deployment bot truy cập được. Không dùng `127.0.0.1`, `localhost` hoặc IP mạng nội bộ của máy Lavalink khi bot chạy trên deployment khác. Giá trị `authorization` phải trùng `LAVALINK_SERVER_PASSWORD` của deployment Lavalink.

Sau khi start bot, kiểm tra:

```text
/music health
```

Nếu health có node nhưng không phát được, kiểm tra:

- Node Lavalink remote có online không.
- Password đúng không.
- Hosting có chặn outbound connection tới host/port đó không.
- Bot có quyền `Connect`, `Speak`, `Use Voice Activity` trong voice channel không.
- Người ra lệnh có ở cùng voice channel với Stella không.

Xem cấu hình deployment Java, password bắt buộc và giới hạn nguồn HTTP tại [Lavalink Trên Bot-Hosting.net](./lavalink-bot-hosting.md).

## Cảnh Báo Secret

Nếu từng gửi token/password SFTP hoặc `.env` cho người khác, xem như đã lộ và nên rotate. Repo private giúp giảm rủi ro, nhưng không thay thế secret hygiene.
