# Deploy Stella Bot Lên Hosting

Tài liệu này dùng cho hosting Node.js/shared hosting (Pterodactyl, bot-hosting.net…).
Không lưu hostname, username, password SFTP trong repo.

## Nguyên Tắc

- **Host tự biên dịch bằng esbuild, không bằng `tsc`.** `postinstall` chạy
  `prisma generate && node scripts/build-dist.js`, nên `git pull` + restart là đủ để code
  mới có hiệu lực. Đừng đưa `tsc` trở lại đường deploy — xem
  [Vì Sao Không Dùng tsc Trên Host](#vì-sao-không-dùng-tsc-trên-host).
- **`dist/` không nằm trong git** (`.gitignore`). Host sinh ra nó lúc `npm install`.
- Secret phải nằm trong `.env` trên hosting, không bao giờ trong repo.
- Không commit hoặc upload nhầm `.env`, backup DB, log cũ, file zip deploy.
- Music cần Lavalink remote nếu hosting không hỗ trợ Docker/Java service chạy nền.
- Database nên là Postgres cloud hoặc provider bền hơn SQLite local.
- **Mọi mốc thời gian bot tính theo `config.maintenance.timezone` (Asia/Saigon), KHÔNG
  phụ thuộc timezone của host** — nhật báo 21h, bài tuần chủ nhật, lời nhắc đều quy
  về giờ Saigon bằng `Intl.DateTimeFormat` với `timeZone` chỉ định. Đặt `TZ` của host
  thế nào cũng được, bot không đọc.

## Deploy Bằng git pull (cách đang dùng)

Trên host, một lần duy nhất: clone repo vào `/home/container`, tạo `.env` từ `.env.example`.

Mỗi lần deploy bản mới:

```bash
git pull
npm install          # postinstall: prisma generate + esbuild dựng lại dist/
npm run db:migrate   # chỉ khi có migration mới
```

Rồi restart. Startup command của panel nên là:

```bash
cd /home/container && if [ -f package.json ]; then npm install --no-fund --no-audit; fi && node index.js
```

Vì `npm install` gọi `postinstall`, mỗi lần restart là một lần biên dịch lại từ nguồn —
host **không thể** chạy code cũ mà không ai biết.

**Đừng nhét `npm run db:migrate` vào startup command.** Migration chạy một lần bằng tay
trong console; để trong startup thì mỗi lần restart lại chờ nó, và lúc DB không truy cập
được bot sẽ crash-loop thay vì báo lỗi một lần.

## Vì Sao Không Dùng tsc Trên Host

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

esbuild viết bằng Go và chỉ dịch cú pháp chứ không dựng type graph, nên dùng vài chục MB
và xong trong dưới một giây cho 250 file.

**Đánh đổi phải biết: esbuild không kiểm type.** Việc đó chuyển về máy dev:

```bash
npm run typecheck    # tsc --noEmit
npm test             # self-check, có assertion chặn tsc quay lại đường deploy
```

Chạy hai lệnh này trước khi push. Không chạy thì lỗi type chỉ lộ lúc bot đang chạy.

`prisma generate` vẫn **bắt buộc phải chạy trên host** vì query engine của Prisma là
binary riêng cho từng nền tảng — không mang từ Windows sang Linux được.

## Deploy Bằng SFTP (cách thay thế)

Nếu host không có git, chạy `npm run host:prepare` ở máy mình. Nó build rồi dựng sẵn thư
mục `host-package/` đúng những gì host cần — upload nguyên thư mục đó lên `/home/container`,
tạo `.env`, `npm install`, `npm run db:migrate`, rồi start.

Cách này host không cần biên dịch, nhưng phải nhớ build và upload lại `dist/` sau mỗi lần
đổi code. `index.js` ở gốc kiểm tra `dist/index.js` trước khi require, nên quên upload thì
bot dừng ngay với thông báo rõ ràng chứ không chạy nửa vời.

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

Lưu ý với cách SFTP: `host-package/` đã có `dist/` sẵn và cố ý không mang `src/` theo.
`scripts/build-dist.js` nhận ra điều đó và giữ nguyên `dist/` thay vì báo lỗi — nhưng đổi
lại, mọi lần đổi code bạn phải tự build và upload lại `dist/`. Nếu `src/` có mà thiếu file
`.ts` thì script dừng ầm ĩ, vì đó là upload lỗi chứ không phải gói pre-built.

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
