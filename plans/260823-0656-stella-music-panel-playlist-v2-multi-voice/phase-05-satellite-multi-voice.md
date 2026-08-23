# Phase 05 — Satellite Bots: Phát Song Song Nhiều Kênh Voice

Trạng thái: TODO
Phụ thuộc: P1, P2
Mục tiêu: 2+ kênh voice trong cùng server phát 2 bài khác nhau cùng lúc, điều khiển vẫn qua bot chính.

## Ràng Buộc Đã Verify

- Discord giữ **một voice state cho mỗi (guild, user)**. Một bot token không thể ở 2 kênh voice trong cùng guild — join kênh thứ 2 là **di chuyển**, không phải thêm. Không có API/trick nào lách.
- Kiến trúc chuẩn của bot nhạc multi-channel (Jockie...) = **nhiều bot application, cùng codebase**.
- **Một Lavalink node phục vụ được nhiều bot**: mỗi client bắt tay WS với header `User-Id` riêng, node trả `sessionId` riêng; player namespace là `/v4/sessions/{sessionId}/players/{guildId}` → cùng guild ở 2 session = 2 player độc lập. Không cần thêm node.
- lavalink-client: **một `LavalinkManager` cho mỗi `Client`**, mỗi cái `client.id` riêng, dùng chung mảng `nodes`.
- ⚠️ `QueueStoreManager` của lavalink-client key theo `guildId` **thôi** → nếu sau này dùng queue store dùng chung (Redis/DB), phải prefix theo bot id, không thì 2 bot ghi đè queue của nhau. Hiện tại dùng store in-memory nên chưa lỗi, nhưng phải comment cảnh báo trong code.

## Kiến Trúc

```
main client (BOT_TOKEN)            → LavalinkManager #0 ─┐
satellite #1 (MUSIC_SATELLITE_...) → LavalinkManager #1 ─┼→ cùng 1 Lavalink node
satellite #2                       → LavalinkManager #2 ─┘
```

- **Bot chính**: giữ slash command, prefix, panel, button, DB. Là bộ điều phối duy nhất.
- **Satellite**: chỉ login + join voice + phát. Không load command, không load event handler, không cần MessageContent/GuildMembers intent (chỉ `Guilds` + `GuildVoiceStates`).
- Người dùng luôn tương tác với bot chính; satellite chỉ là "cái loa".

### Env

```env
# JSON array token. Mỗi token = 1 Discord application riêng, phải invite vào server với quyền Connect + Speak.
MUSIC_SATELLITE_TOKENS=["token_bot_2","token_bot_3"]
```

- Token sai/không login được → log warn, bot chính vẫn chạy bình thường (không crash).
- Không có env này → hành vi y hệt hiện tại.

### Session Router (`music-session-router.ts`)

`acquireSessionForMember(member, textChannelId)`:

1. Đã có session ở đúng kênh voice của member → dùng lại (thêm bài vào queue đó).
2. Chưa có → chọn entry **chưa có player nào trong guild này**, ưu tiên main → satellite theo thứ tự khai báo.
3. Hết entry rảnh → lỗi rõ ràng: `Tất cả 3 bot nhạc đang bận: Stella ở #chill, Stella Music 2 ở #game, Stella Music 3 ở #study. Vào một trong các kênh đó để thêm bài nhé.`

`resolveControllableSession(member)`: tìm session mà member đang ở cùng kênh voice → mọi nút/lệnh điều khiển đều đi qua đây, nên không cần biết bot nào đang phát.

### Panel Đa Session

- Mỗi session có panel riêng (`panelMessageId` theo session, P2 đã có).
- Embed thêm dòng `Loa: Stella Music 2 • Kênh: #game` để user biết bot nào đang phát ở đâu.
- `/music sessions` (hoặc mở rộng `/music health`): liệt kê tất cả session đang chạy trong server + bài đang phát + số bài queue.

### Command Mới

- `/music satellites`: trạng thái từng satellite (đã login? có trong server? đang ở kênh nào?) + **link invite** cho cái chưa vào server (`https://discord.com/oauth2/authorize?client_id=<id>&scope=bot&permissions=3145728` — Connect 1<<20 + Speak 1<<21).
- Chỉ ManageGuild xem được (tránh lộ danh sách bot phụ cho mọi người).

## Files

- Sửa: `music-client-pool.ts` (bootstrap satellite, mỗi client 1 manager + tự forward `raw` của chính nó — **không được cross-wire**), `music-session-router.ts` (chọn entry rảnh), `music-panel.ts` (hiện tên loa), `music-queue-service.ts` (nhận session thay vì client+guildId), `src/index.ts` (login satellite sau khi main login trong `init()`), `src/commands/music.ts` (`/music satellites`, `/music sessions`).
- Mới: `src/systems/music/music-satellite-bootstrap.ts`.
- Docs: `docs/music-setup.md` phần "Thêm bot phụ để phát nhiều kênh", `.env.example`.

## Validation

Không có satellite token:

- `s!play` chạy như cũ; người ở kênh khác xin nhạc → vẫn báo lỗi cũ.

Có 1 satellite token (test thật):

1. User A ở `#voice-1` `s!play bài A` → bot chính vào `#voice-1`.
2. User B ở `#voice-2` `s!play bài B` → satellite vào `#voice-2`, **2 bài phát song song**, 2 panel riêng.
3. B bấm Skip trên panel của mình → chỉ session `#voice-2` bị skip.
4. A bấm Stop → chỉ bot chính rời `#voice-1`, satellite vẫn phát.
5. User C ở `#voice-3` `s!play` → lỗi "hết bot rảnh" liệt kê đúng kênh.
6. Queue `#voice-2` hết → satellite tự rời sau 30s, sau đó C ở `#voice-3` play được (satellite được tái sử dụng).
7. `npm run build`, `npm test`.

## Risks

- **Chi phí vận hành**: mỗi satellite = 1 gateway connection + 1 player Lavalink (RAM theo `frameBufferDurationMs`). 2-3 satellite là hợp lý, đừng dựng 10.
- Satellite chưa được invite vào server → phải báo lỗi hướng dẫn invite, không throw vô nghĩa.
- Satellite thiếu quyền Connect/Speak ở kênh đó → check permission trước khi chọn entry, nếu thiếu thì thử entry tiếp theo.
- Nhiều bot cùng vào 1 voice channel: **chặn** (vô nghĩa, chồng tiếng). Router chỉ cho 1 session / kênh.
- Rate limit voice state update khi nhiều bot join/leave liên tục → giữ `destroyAfterMs: 30_000` như hiện tại, không hạ thấp.
- Nếu sau này thêm queue persistence dùng chung: **phải prefix key theo bot id** (xem cảnh báo `QueueStoreManager` ở trên).
