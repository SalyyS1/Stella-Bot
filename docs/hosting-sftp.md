# Deploy Stella Bot Lên Hosting Qua SFTP

Tài liệu này dùng cho hosting Node.js/shared hosting. Không lưu hostname, username, password SFTP trong repo.

## Nguyên Tắc

- Source có thể upload qua SFTP, secret phải nằm trong `.env` trên hosting.
- Không commit hoặc upload nhầm `.env`, backup DB, log cũ, file zip deploy.
- Music cần Lavalink remote nếu hosting không hỗ trợ Docker/Java service chạy nền.
- Database nên là Postgres cloud hoặc provider bền hơn SQLite local.

## File Nên Upload

- `src/`
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

Sau khi start bot, kiểm tra:

```text
/music health
```

Nếu health có node nhưng không phát được, kiểm tra:

- Node Lavalink remote có online không.
- Password đúng không.
- Hosting có chặn outbound connection tới host/port đó không.
- Bot có quyền `Connect`, `Speak`, `Use Voice Activity` trong voice channel không.

## Cảnh Báo Secret

Nếu từng gửi token/password SFTP hoặc `.env` cho người khác, xem như đã lộ và nên rotate. Repo private giúp giảm rủi ro, nhưng không thay thế secret hygiene.
