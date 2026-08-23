# Phase 03 — Playlist Cá Nhân v2 (Nhiều Playlist, Ảnh Bìa, Share)

Trạng thái: TODO
Phụ thuộc: P1
Mục tiêu: mỗi người có nhiều playlist lưu lâu dài, tự đặt tên + ảnh bìa, save bài đang phát bằng 1 nút, share cho người khác play/copy.

## Hiện Trạng

`MusicPlaylistTrack` = 1 playlist phẳng / user, tối đa 20 bài, phải tự nhập `title` + `uri` bằng tay. Không có tên, ảnh, share.

## Schema Mới

```prisma
model MusicPlaylist {
  id          Int      @id @default(autoincrement())
  userId      String
  name        String
  description String?
  coverUrl    String?  // link ảnh https do user dán
  coverMessageId String? // message id trong asset channel nếu user upload file
  isPublic    Boolean  @default(false)
  shareCode   String   @unique
  playCount   Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  user   User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  tracks MusicPlaylistItem[]

  @@unique([userId, name])
  @@index([userId])
}

model MusicPlaylistItem {
  id         Int      @id @default(autoincrement())
  playlistId Int
  position   Int
  title      String
  author     String?
  uri        String
  identifier String?  // để resolve lại nhanh, khỏi search theo tên
  source     String?
  duration   Int?
  artworkUrl String?
  addedAt    DateTime @default(now())

  playlist MusicPlaylist @relation(fields: [playlistId], references: [id], onDelete: Cascade)

  @@unique([playlistId, position])
  @@index([playlistId])
}
```

Thêm vào `model User`: `musicPlaylists MusicPlaylist[]` (giữ `musicPlaylistTracks` cho tới khi drop bảng cũ).

Giới hạn (khai báo trong `src/config.ts` → `config.music.playlist`): 5 playlist/user, 100 bài/playlist, enqueue tối đa 50 bài/lần play.

## Migration + Backfill

`prisma migrate dev --create-only` rồi thêm backfill vào cuối file SQL (Postgres):

```sql
INSERT INTO "MusicPlaylist" ("userId", "name", "shareCode", "createdAt", "updatedAt")
SELECT DISTINCT t."userId", 'Playlist cũ', upper(substr(md5(random()::text || t."userId"), 1, 8)), now(), now()
FROM "MusicPlaylistTrack" t;

INSERT INTO "MusicPlaylistItem" ("playlistId", "position", "title", "uri", "source", "duration", "addedAt")
SELECT p."id", t."position", t."title", t."uri", t."source", t."duration", t."addedAt"
FROM "MusicPlaylistTrack" t
JOIN "MusicPlaylist" p ON p."userId" = t."userId" AND p."name" = 'Playlist cũ';
```

- **Không drop `MusicPlaylistTrack` ở migration này.** Verify xong (`npm run db:verify` + xem 1-2 user thật) mới drop ở migration sau.
- Chạy: local `npm run db:push` không dùng được vì cần SQL tay → dùng `npx prisma migrate dev`; host chạy `npm run db:migrate`.

## Ảnh Bìa

2 đường vào:

1. **Dán link**: chỉ nhận `https://`, đuôi `.png/.jpg/.jpeg/.gif/.webp` (cho phép query string), độ dài ≤ 300. Lưu `coverUrl`.
2. **Upload file** (slash option `attachment`): bot re-upload ảnh vào asset channel (`MUSIC_ASSET_CHANNEL_ID`), lưu `coverMessageId`. Lý do: URL attachment của Discord bây giờ có signature hết hạn (`?ex=...&is=...&hm=...`), lưu thẳng URL sẽ chết ảnh sau vài ngày. Khi render, nếu có `coverMessageId` thì fetch message lấy URL tươi, cache in-memory 1 giờ.

Validate: giới hạn size ≤ 8MB, content type phải `image/*`. Nếu asset channel chưa cấu hình → chỉ cho dán link, báo lỗi rõ.

## Commands

Slash group `/music playlist`:

| Sub | Mô tả |
|---|---|
| `create name: [cover] [description]` | tạo playlist, sinh `shareCode` |
| `list` | playlist của tôi (số bài, tổng thời lượng, public/private) |
| `show name: [page]` | xem chi tiết, ảnh bìa làm embed image, 10 bài/trang, nút ◀ ▶ |
| `add name: query:` | search rồi lưu bài (không cần nhập uri tay) — dùng select nếu nhiều kết quả |
| `save-current name:` | lưu bài đang phát |
| `remove name: position:` | xóa 1 bài, dồn position |
| `move name: from: to:` | đổi thứ tự |
| `cover name: [url] [file]` | đặt/đổi ảnh bìa |
| `rename name: new-name:` | đổi tên |
| `delete name:` | xóa playlist (confirm button) |
| `play name: [shuffle]` | phát playlist của mình |
| `share name:` | bật public + trả `shareCode` |
| `open code:` | xem playlist người khác (chỉ nếu public) |
| `copy code: [name]` | clone về playlist của mình |

- Option `name` dùng **autocomplete** (playlist của chính user) → thêm nhánh `interaction.isAutocomplete()` trong `interactionCreate.ts` + hàm `autocomplete()` trong `src/commands/music.ts`.
- Prefix: `s!save [tên playlist]`, `s!pl` (list), `s!pl play <tên>`.
- Nút `💾 Lưu vào playlist` ở panel (P2) → select menu playlist của user + option `➕ Tạo playlist mới` (mở modal nhập tên).

## Play Playlist (Performance)

- Resolve theo `identifier`/`uri` trực tiếp thay vì search theo title (nhanh + đúng bài hơn).
- Concurrency 5 (`Promise.all` theo lô), không tuần tự 100 lần như hiện tại.
- Trả kết quả `queued / skipped` như cũ; nếu > 50 bài thì lấy 50 bài đầu và nói rõ.
- Tăng `playCount` sau khi enqueue thành công.

## Files

- `prisma/schema.prisma` + migration mới.
- `src/systems/music/music-playlist-service.ts` (rewrite: CRUD v2, share code, copy, resolve cover).
- Mới: `src/systems/music/music-playlist-commands.ts` (slash + prefix + component handler), `music-cover-resolver.ts`.
- Sửa: `src/commands/music.ts` (subcommand mới + autocomplete), `src/events/interactionCreate.ts` (autocomplete branch), `src/config.ts`, `.env.example` (`MUSIC_ASSET_CHANNEL_ID`), `docs/database.md`.

## Validation

```powershell
npx prisma migrate dev
npm run build
npm test
npm run db:verify
```

- Test data thật: user có playlist cũ → sau migration `/music playlist list` thấy "Playlist cũ" đủ số bài.
- Tạo 2 playlist, đặt ảnh bìa cả 2 kiểu (link + upload), share code cho account khác → `open`/`play`/`copy` chạy.
- Vượt giới hạn (6 playlist, 101 bài) → lỗi tiếng Việt rõ ràng, không stack trace.

## Risks

- Migration trên host là bước rủi ro nhất → backup trước (`npm run db:backup`), giữ bảng cũ.
- `@@unique([userId, name])` → tạo trùng tên phải báo lỗi thân thiện, không throw P2002 thô.
- `shareCode` trùng (rất khó nhưng có thể): retry sinh code tối đa 5 lần.
- Playlist public là dữ liệu user tự đặt → sanitize tên/description khi render (không cho ping `@everyone`, dùng `allowedMentions` mặc định của bot đã parse users/roles → phải set `allowedMentions: { parse: [] }` cho các reply render nội dung playlist).
- Ảnh bìa là URL bên ngoài do user đặt → chỉ nhận https + đuôi ảnh, không fetch server-side (tránh SSRF), để Discord tự proxy.
