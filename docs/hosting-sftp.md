# Deploy Stella Bot Lên Hosting Qua SFTP

Tài liệu này dùng cho hosting Node.js/shared hosting. Không lưu hostname, username, password SFTP trong repo.

## Nguyên Tắc

- Source có thể upload qua SFTP, secret phải nằm trong `.env` trên hosting.
- **Build ở máy mình, không build trên host.** `tsc` cần nhiều RAM hơn hạn mức của
  shared hosting nên sẽ bị kernel kill (`exit code 137`, `Out of memory: true`) — xem
  mục [Không Build Trên Host](#không-build-trên-host). `postinstall` trên host chỉ chạy
  `prisma generate`.
- Không commit hoặc upload nhầm `.env`, backup DB, log cũ, file zip deploy.
- Music cần Lavalink remote nếu hosting không hỗ trợ Docker/Java service chạy nền.
- Database nên là Postgres cloud hoặc provider bền hơn SQLite local.
- **Mọi mốc thời gian bot tính theo `config.maintenance.timezone` (Asia/Saigon), KHÔNG
  phụ thuộc timezone của host** — nhật báo 21h, bài tuần chủ nhật, lời nhắc đều quy
  về giờ Saigon bằng `Intl.DateTimeFormat` với `timeZone` chỉ định. Đặt `TZ` của host
  thế nào cũng được, bot không đọc.

## Không Build Trên Host

`tsc` phải nạp toàn bộ type của Prisma Client (60+ model, file `.d.ts` vài MB) cùng
250+ file nguồn. Đỉnh RAM của nó vượt hạn mức container của shared hosting, và cgroup
kill tiến trình bằng SIGKILL — biểu hiện là:

```text
npm error code 137
npm error command sh -c prisma generate && tsc
[Bot-Hosting Daemon]: Exit code: 137
[Bot-Hosting Daemon]: Out of memory: true
```

Tăng `--max-old-space-size` **làm nặng thêm** chứ không chữa được: hạn mức bị chạm là
RAM của cả container, không phải heap của Node.

Vì vậy `postinstall` chỉ chạy `prisma generate` (nhẹ, và **bắt buộc phải chạy trên host**
vì query engine của Prisma là binary riêng cho từng nền tảng). Việc biên dịch thuộc về
máy dev, và `dist/` được upload cùng source.

`index.js` ở gốc repo kiểm tra `dist/index.js` trước khi require, nên nếu quên upload
`dist/` thì bot dừng ngay với thông báo rõ ràng chứ không chạy nửa vời.

## File Nên Upload

Cách gọn nhất: chạy `npm run host:prepare` ở máy mình. Nó build rồi dựng sẵn thư mục
`host-package/` đúng những gì host cần — upload nguyên thư mục đó lên `/home/container`.

Nếu upload tay thì cần:

- `dist/` — **bắt buộc**, đây là code đã biên dịch. Build lại và upload lại mỗi lần đổi code.
- `index.js` (bootstrap ở gốc, chỉ để require `dist/index.js`)
- `src/assets/` — font tiếng Việt và ảnh game nhúng sẵn, host không cần cài font. Code
  tìm ở cả `assets/`, `src/assets/` và `dist/assets/` tính từ cwd, nên đặt ở đâu trong ba
  chỗ đó cũng được (`host:prepare` đặt thành `assets/` ở gốc).
- `prisma/` trừ file SQLite local
- `docs/` nếu muốn giữ hướng dẫn trên host
- `lavalink/` và `docker-compose.lavalink.yml` chỉ cần nếu host/VPS chạy được Docker
- `package.json`
- `package-lock.json`

Không upload:

- `.env`
- `node_modules/`
- `src/` (trừ `src/assets/`) và `tsconfig.json` — host không biên dịch nên không cần,
  và có `src/` trên host chỉ làm người sau tưởng sửa ở đó là có tác dụng
- `*.zip`
- `backups/`
- `prisma/*.db`

## Setup Trên Hosting

1. Ở máy mình: `npm run build` (hoặc `npm run host:prepare`).
2. Upload lên host qua SFTP.
3. Tạo `.env` trực tiếp trên hosting từ `.env.example`.
4. Chạy:

```bash
npm install          # postinstall tự chạy prisma generate
npm run db:migrate
npm start
```

Nếu panel có mục startup command, dùng:

```bash
npm start
```

Panel kiểu Pterodactyl thường có sẵn dạng này và dùng được luôn:

```bash
if [ -f /home/container/package.json ]; then npm install --no-fund --no-audit; fi && node /home/container/index.js
```

**Đừng nhét `npm run db:migrate` vào startup command.** Migration chạy một lần bằng tay
trong console; để trong startup thì mỗi lần restart lại chờ nó, và lúc DB không truy cập
được bot sẽ crash-loop thay vì báo lỗi một lần.

Không dùng `npm run build` trên host — xem [Không Build Trên Host](#không-build-trên-host).

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
