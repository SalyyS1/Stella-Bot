# Bộ Quản Lý Cộng Đồng

Tài liệu vận hành cho phần thay thế Carl-bot / Dyno / ProBot / VoiceMaster / Ticket Tool / Statbot.
Cập nhật: 2026-08-26.

## Bản Đồ: Bot Ngoài → Lệnh Của Stella

| Bot ngoài | Tính năng | Thay bằng |
|---|---|---|
| Carl-bot | reaction role | `/rolemenu` |
| Carl-bot | tag | `/tag`, `!tag <tên>` |
| Carl-bot | sticky message | `/sticky` |
| Carl-bot | starboard | `/starboard` |
| Carl-bot | highlight từ khoá | `/highlight` |
| Carl-bot | auto-thread | `/autothread` |
| Carl-bot / Dyno | embed builder | `/embed` |
| Carl-bot / Dyno / ProBot | automod | `/automod` |
| Carl-bot / Dyno | log kiểm duyệt | có sẵn (`/snipe`, `/inspect`, `/case`, `/modreport`) |
| Carl-bot | log voice | tự động (`config.logs.voice`) |
| Dyno / ProBot | AFK | `/afk` |
| Dyno | moderation | `/ban` `/kick` `/timeout` `/warn` `/purge` |
| Dyno | lockdown / slowmode | `/lockdown`, `/slowmode` |
| Dyno / Carl-bot | autorole | `/autorole` |
| Dyno | role tạm có hạn | `/role add @u @r 3d` |
| ProBot | welcome + level | có sẵn (`guildMemberAdd`, `/profile`, `/top`) |
| VoiceMaster | phòng voice tạm | `/tempvoice` |
| Ticket Tool / ModMail | ticket hỗ trợ | `/ticket` |
| Statbot / Server Stats | kênh đếm số liệu | `/statschannel` |
| Simple Poll / Dyno | bình chọn | `/poll` |
| Statbot / Amaribot | xếp hạng giờ voice | `/voicetop` |
| — | cổng xác minh | `/verify` |
| — | theo dõi thành viên | `/watch` |
| — | cảnh báo acc lạ lúc join | tự động, nút Kick/Ban ở kênh log |

## Cài Đặt Lần Đầu

Chạy theo thứ tự này. Mọi lệnh đều ephemeral (chỉ người gõ thấy).

```
1. /automod status                      → xem 11 luật đang bật/tắt
2. /rolemenu create title:… description:…
   /rolemenu add id:1 role:@… label:…
   /rolemenu post id:1 channel:#…
3. /tempvoice setup category:… template:"🔊 Phòng của {user}"
4. /starboard setup channel:#bang-vang threshold:4
5. /sticky set content:"…"              → chạy TRONG kênh cần ghim
6. /tag create name:ip content:"…"      → /tag trigger name:ip keyword:ip
7. /verify setup role:@Member channel:#verify
8. /ticket setup category:… staff_role:@Mod channel:#ho-tro
9. /statschannel setup kind:members     → lặp lại cho từng loại cần đếm
```

### Quyền bot cần có

`Manage Roles` (role menu, verify, autorole, role tạm) · `Manage Channels` (phòng voice tạm,
lockdown, slowmode, kênh ticket, kênh thống kê) · `Manage Messages` (automod xoá tin, sticky) ·
`Manage Threads` (auto-thread) · `Moderate Members` (nút timeout của mod) ·
`Kick`/`Ban Members` (nút xử acc lạ) · `Manage Server` + `View Audit Log` (đã cần từ trước cho
invite + log).

Riêng `/statschannel setup kind:online` cần thêm intent **Guild Presences** (bật ở Developer
Portal *và* trong `src/index.ts`); thiếu intent thì lệnh từ chối kèm hướng dẫn thay vì tạo một
kênh đứng số mãi không đổi.

Thiếu quyền nào sẽ được báo vào botLog lúc bot khởi động — xem `permission-preflight.ts`.

## Automod

**Bot chỉ xoá tin và báo mod. Bot không tự timeout ai** (Saly chốt 2026-08-25).

Khi có người chạm luật:
1. Tin bị xoá, người đó nhận một lời nhắc trong kênh (tự xoá sau 8 giây).
2. Một embed vào kênh log. Cùng một người chạm cùng một luật trong 60 giây được **gộp**
   vào một embed có đếm số lần, để một đợt flood không làm ngập chính kênh log.
3. Chạm 3 / 5 / 8 lượt trong 10 phút → embed đỏ kèm nút `Timeout 10 phút` /
   `Timeout 1 tiếng` / `Ghi cảnh cáo` / `Bỏ qua`. Mod bấm thì mới có hình phạt.

### 11 luật

| Luật | Mặc định | Bắt gì |
|---|---|---|
| `flood` | bật | 6 tin trong 5 giây |
| `duplicate` | bật | gửi lại cùng nội dung 3 lần trong 30 giây |
| `massMention` | bật | ping hơn 6 người/role trong một tin |
| `caps` | bật | ≥ 75% chữ hoa, tính trên tin có ≥ 12 **chữ cái** |
| `inviteLink` | bật | link mời server khác |
| `links` | **tắt** | mọi link ngoài allowlist |
| `scamLink` | bật | tên miền mạo danh Discord/Steam/Nitro |
| `emojiSpam` | bật | hơn 12 emoji một tin |
| `newlineSpam` | bật | hơn 15 dòng một tin |
| `bannedWords` | **tắt** | từ khoá tự thêm, khớp theo từ |
| `zalgo` | bật | ký tự phá layout |

### Miễn trừ

Luôn được miễn: ai có quyền **Manage Messages**, và ba kênh sống bằng link — `serverAds`,
`share`, `showcase`. Ba kênh này được ghi cứng trong `automod-settings.ts` và lệnh
`/automod exempt` không gỡ được, vì gỡ chúng là làm bài quảng cáo bị xoá trước khi bot
kịp xử lý form.

Thêm miễn trừ: `/automod exempt role @Mod add:true` · `/automod exempt channel #kenh add:true`.

### Chỉnh giữa lúc đang bị spam

```
/automod off                      → tắt hẳn, không cần deploy
/automod rule rule:caps enabled:false
/automod words add word:…         → tự bật luật bannedWords
/automod strikes user:@… clear:true
```

Ngưỡng (6 tin/5s…) nằm trong `config.automod.defaults` và cần deploy để đổi; việc
**bật/tắt** thì nằm trong DB và có hiệu lực ngay.

## Role Menu

- `mode`: `multi` (chọn bao nhiêu tuỳ thích) · `unique` (chỉ giữ một role trong menu) ·
  `verify` (chỉ cấp, bấm lại không gỡ).
- `style`: `button` (≤ 20 nút) · `select` (menu thả xuống, ≤ 25 mục).
- `/rolemenu add` và `/rolemenu remove` tự cập nhật tin nhắn đã đăng.
- `/rolemenu delete` xoá luôn tin nhắn — không để lại menu chết mà người ta vẫn bấm được.

**Role bị từ chối** (cả lúc thêm lẫn lúc bấm): role do bot/Nitro quản lý, `@everyone`,
role cao hơn hoặc ngang role của Stella, và bất kỳ role nào có `Administrator`,
`Manage Server`, `Manage Roles`, `Manage Channels`, `Manage Webhooks`, `Manage Messages`,
`Ban`, `Kick`, `Moderate Members`, `Mention Everyone`. Một menu công khai phát role có
quyền quản trị là đường để bất kỳ ai bấm nút cũng tự lên admin.

## Cổng Xác Minh

`/verify setup role:@Member channel:#verify` dựng một role menu `verify` một lựa chọn.

**Bot cố ý không tự khoá kênh.** Sau khi chạy lệnh, phải tự làm: Server Settings → Roles →
`@everyone` → bỏ **View Channel** ở các kênh cần khoá → cấp quyền đó cho role member.
Lý do không tự động: sửa quyền hàng loạt trên mọi kênh là thao tác khó lùi, và sai một
chỗ thì cả server mất quyền xem.

## Phòng Voice Tạm

Vào kênh hub → bot tạo phòng riêng, kéo người đó vào, đăng panel trong chat của kênh voice.

Panel (chỉ chủ phòng): Đổi tên · Khoá/Mở · Ẩn/Hiện · Giới hạn người · Đuổi khỏi phòng ·
Nhường chủ. Nút **Nhận chủ phòng** mở cho mọi người trong phòng, nhưng chỉ dùng được khi
chủ cũ đã rời.

- Trần: 30 phòng cùng lúc toàn server, 1 phòng mỗi người (`config.tempVoice`).
- Phòng trống 15 giây → tự xoá. Vào lại trong khoảng đó thì huỷ hẹn giờ.
- Bot restart → `reconcileTempVoiceChannels` dọn phòng rỗng còn sót. Chạy tay:
  `/tempvoice cleanup`.
- `/tempvoice remove` chỉ gỡ hub khỏi DB, **không** xoá kênh — xoá kênh mà người ta không
  yêu cầu là việc không lùi được.
- Không đuổi được thành viên có quyền `Manage Channels`, và không nhường phòng cho bot.
- Discord chỉ cho đổi tên kênh **2 lần mỗi 10 phút**; lần thứ ba báo lỗi, không phải bot hỏng.

## Tag / Autoresponder

- `/tag create name:… content:…` rồi gọi bằng `/tag show` hoặc `!tag <tên>`.
- `/tag trigger name:… keyword:…` biến tag thành autoresponder: ai nhắc từ khoá đó trong
  chat thường sẽ được bot trả lời. Khớp **theo từ** — trigger `ip` không khớp trong
  `script` hay `vip`. Nhịp tối thiểu 30 giây mỗi kênh.
- Autoresponder chạy cuối pipeline nên **không** chen vào kênh có luật riêng (share,
  showcase, form request, welcome, Q&A).
- Nội dung tag do bot gửi nên luôn bị chặn mention: `@everyone` trong tag không ping ai.

## Sticky

`/sticky set content:… gap:5` chạy trong kênh cần ghim. Sau mỗi 5 tin, bot xoá bản cũ rồi
đăng bản mới xuống cuối — luôn chỉ có một bản. Bộ đếm nằm trong DB nên restart không làm
sticky nhảy lung tung.

## Starboard

`/starboard setup channel:#bang-vang threshold:4`. Thả ⭐ đủ ngưỡng → tin được đăng lại.

- Sao của **chính tác giả** và của bot không được tính.
- Rút sao xuống dưới ngưỡng → bài rời bảng.
- Tin gốc bị xoá → bài trên bảng cũng bị dọn (không để lại link chết).
- Bài trên bảng **không ping** tác giả.
- Ngưỡng lưu ở bảng `ManagedChannel` key `starboard:threshold`, đổi được bằng lệnh.

## AFK

`/afk lý do` → thêm `[AFK]` vào nickname (nếu bot đổi được), ai ping bạn sẽ được bot nhắc
kèm mốc thời gian. Chat lại một câu bất kỳ là tự tắt. Lý do AFK bị gỡ mọi mention trước
khi hiện ra cho người khác.

## Tầng 2 (đã làm 2026-08-25)

### Kiểm duyệt nâng cao

- **Log voice** — tự động, gộp một dòng mỗi phiên kèm thời lượng. Tắt bằng
  `config.logs.voice.enabled = false`. Bot nhạc bị bỏ qua.
- **Cảnh báo acc lạ** — acc mới < 7 ngày, hoặc ≥ 2 dấu hiệu (không avatar, tên kết thúc
  bằng ≥ 4 chữ số, tên toàn chữ thường không có nghĩa) → embed ở kênh log kèm nút
  `Kick` / `Ban` / `Bỏ qua`. **Bot không tự xử**: mấy dấu hiệu này cũng đúng với người
  thật vừa lập Discord để vào server bạn bè.
- `/watch on user:@… duration:2d reason:…` — Administrator only. Tin của người đó được
  copy sang kênh log tới khi hết hạn, tự tắt, và luôn ghi hồ sơ `WATCH` để có dấu vết
  ai bật. Trần 30 ngày (`config.moderation.watchMaxDays`).
- `/lockdown on|off|lift|list` — khoá quyền chat của `@everyone`. `off` **xoá** overwrite
  chứ không set `true`, nên kênh về đúng trạng thái trước khi khoá. `lift` chỉ mở những
  kênh chính bot đã khoá, không quét cả server.
- `/slowmode <giây> [channel]` — 0 = tắt, trần 21600 (giới hạn Discord).

### Role tự động

- `/autorole add|remove|list` — role cấp cho mọi người mới. Chạy sau khi trả role kỷ luật.
  Role đi qua cổng an toàn **hai lần** (lúc thêm và lúc cấp): đây là đường phát role rộng
  nhất của bot, sai một lần là mọi acc mới đều thành mod.
- `/role add @u @r 3d [lý do]` · `/role remove` · `/role list` — role có hạn. Bot quét
  mỗi phút **và ngay khi khởi động**, nên role đáng ra hết hạn lúc bot tắt được gỡ ngay
  khi bot lên. Cấp lại cùng role = gia hạn, không sinh dòng thứ hai.

### Tiện ích

- `/highlight add|remove|list|clear` — mọi member dùng được. Ai nhắc từ khoá của bạn thì
  bạn nhận DM kèm link. Cổng chống lạm dụng: từ khoá ≥ 3 ký tự, tối đa 10 từ mỗi người,
  không gửi về tin của chính mình, **không gửi nếu bạn không có quyền đọc kênh đó**
  (nếu không thì highlight là cách đọc lén kênh riêng), và tối đa 1 DM/5 phút/kênh.
- `/autothread on|off|list` — tự mở thread cho mỗi tin. Bỏ qua tin trống, tin đã có
  thread, và bỏ qua `share`/`showcase` (hai kênh đó đã có logic thread riêng).
- `/embed title:… description:… [color] [image] [footer] [channel]` — gửi embed dưới danh
  nghĩa bot. Dùng `\n` để xuống dòng. Mọi mention bị chặn. Màu sai định dạng thì dùng màu
  mặc định chứ không lỗi; ảnh chỉ nhận link `https`.

### Bản tin kiểm duyệt

`/modreport [days]` (mặc định 7, `ModerateMembers`, ephemeral) — số tin bị xoá/sửa, top 5
người bị xoá tin, hồ sơ kỷ luật mới, vi phạm automod theo luật, người mới + tỷ lệ giữ
người, số đang bị theo dõi và số kênh đang khoá. **Mục nào bằng 0 thì bị bỏ khỏi embed**.

Tự đăng vào kênh log **Chủ nhật sau 20h giờ Saigon**, chống đăng trùng bằng `claimWork`.
Cố ý tách khỏi tờ báo cộng đồng (`report-weekly.ts`): đó là bài do AI viết cho cả server
đọc, còn đây là số liệu nội bộ không cần AI — một lỗi số liệu ở đây không được phép chặn
tờ báo.

## Tầng 3 (đã làm 2026-08-26)

### Ticket / Modmail

`/ticket setup category:… staff_role:@Mod channel:#ho-tro` dựng panel một nút. Người bấm được
hỏi chủ đề bằng modal rồi bot mở một kênh riêng chỉ họ và ban quản trị đọc được.

- Quyền kênh đặt **ngay trong lời gọi tạo kênh**, không tạo trước rồi khoá sau: khoảng vài
  trăm ms ở giữa là đủ để cả server đọc được nội dung mà người ta chọn không kể công khai.
- Ghi DB lỗi → bot **xoá luôn kênh vừa tạo**, thà không có ticket hơn là có một kênh mồ côi
  mà `/ticket close` không nhận ra.
- Trần 2 ticket mở mỗi người (`TicketConfig.maxPerUser`).
- Nút `Nhận xử lý` ghi tên người nhận; `Đóng ticket` xuất **transcript .txt** (tối đa 500 tin)
  vào kênh log rồi xoá kênh sau 5 giây.
- `/ticket add|remove` **chỉ ban quản trị dùng được** — người mở ticket không được tự kéo
  người khác vào đọc hồ sơ của chính họ.
- `/ticket list` xem ticket đang mở, `/ticket status` xem cấu hình. Bot restart →
  `reconcileTickets` đóng hồ sơ của kênh đã bị xoá tay.

### Kênh Thống Kê

`/statschannel setup kind:members [label]` tạo một kênh voice khoá `Connect`, tên là số liệu.
6 loại: `members` · `humans` · `bots` · `online` · `voice` · `boosts`.

- Nhịp cập nhật `config.stats.updateIntervalMs` (15 phút), có **sàn 10 phút**. Discord chỉ
  cho đổi tên kênh 2 lần/10 phút và **vượt trần thì request bị treo trong hàng đợi chứ không
  báo lỗi** — kéo theo mọi request khác của bot. Đặt dưới sàn thì bot ghi log cảnh báo và
  dùng sàn.
- Số không đổi thì **không gọi setName**, để dành hạn mức cho lần số thật sự đổi.
- Kênh bị xoá tay → dòng DB tự bị dọn ở lần refresh sau. `/statschannel refresh` chạy tay.

### Bình Chọn

`/poll question:… options:"A | B | C" [hours] [multi]` — dùng **poll gốc của Discord**, không
tự dựng bằng nút. Discord đã lo lưu phiếu, chặn bỏ phiếu hai lần, ẩn kết quả tới lúc đóng và
hẹn giờ đóng kể cả khi bot tắt. Trần: 10 lựa chọn, 55 ký tự mỗi lựa chọn, 768 giờ. Cần
`Manage Messages`, mọi mention bị chặn.

### Xếp Hạng Giờ Voice

`/voicetop [range]` (`week` / `all`) và một dòng 🔊 Voice trong `/profile`.

**Không đếm** kênh AFK của server và khoảng người đó **tự tắt tai nghe** — một bảng "giờ
voice" thô chỉ đo ai để máy chạy lâu nhất, không đo ai tham gia nhiều nhất. Phiên < 60 giây
không ghi (vào/ra liên tục sẽ sinh hàng loạt lượt ghi DB vô nghĩa). Phiên đang chạy nằm
trong RAM nên bot restart giữa phiên là mất phiên đó — đổi lại không phải ghi DB mỗi phút
cho từng người trong voice. `weekSeconds` reset **lúc ghi** bằng cách so `weekKey`, nên
không cần scheduler quét cả bảng lúc nửa đêm Chủ nhật.

Cố ý tách khỏi log voice (`voice-log.ts`): log là dấu vết cho mod đọc, đây là số liệu tích
luỹ cho member xem.

## Còn Có Thể Làm Thêm

Không còn gì trong danh sách bot ngoài — Carl-bot, Dyno, ProBot, VoiceMaster, Ticket Tool,
Statbot đều đã có phần thay thế. Danh sách dưới đây là ý tưởng mới, **chưa ai yêu cầu**, xếp
theo giá trị so với công bỏ ra. Xem `plans/reports/cook-260826-*-report.md` để biết chi tiết.

**Đáng làm trước**

1. **Nhật ký thay đổi role/nickname** — `guildMemberUpdate` đã có sẵn, chỉ thiếu phần so sánh
   role cũ/mới và ghi log. Rẻ nhất, và là thứ mod hỏi nhiều nhất khi có tranh chấp.
2. **`/case appeal`** — cho người bị warn/timeout gửi kháng nghị vào kênh mod, thay vì DM
   riêng cho từng mod. Dùng lại bảng `ModCase`.
3. **Reaction-role bằng emoji thật** — hiện `/rolemenu` chỉ có nút và select. Một số server
   quen kiểu thả emoji vào tin nhắn; `messageReactionAdd` đã được nối sẵn cho starboard.
4. **Automod cho tên hiển thị** — hiện automod chỉ soi nội dung tin. Nick chứa link scam
   hoặc zalgo thì lọt. Dùng lại `automod-rules.ts` gần như nguyên vẹn.

**Nên bàn trước khi làm**

5. **Lịch nhắc / sự kiện** — nhắc trước giờ bảo trì server, event, wipe map. Cần chọn giữa
   Discord Scheduled Events (miễn phí, có sẵn UI) và bảng riêng + scheduler.
6. **Backup cấu hình ra file** — xuất toàn bộ setting (automod, rolemenu, tag, sticky…) ra
   JSON để phục hồi sau sự cố DB. Việc khó nhất là phiên bản hoá schema.
7. **Dashboard web** — mọi setting hiện chỉ chỉnh bằng lệnh. Một trang web đòi thêm auth,
   hosting và một bề mặt tấn công mới; chỉ nên làm khi số setting vượt sức chịu của slash
   command.
8. **Anti-raid theo nhịp join** — phát hiện 10 acc vào trong 60 giây → tự bật cổng verify.
   Cần chốt trước: bot được **tự** làm gì, vì raid thật và một lượt quảng cáo thành công
   trông giống nhau.

**Chưa nên làm**

9. **Tự động ban theo danh sách đen toàn cầu** — phụ thuộc API ngoài, và một lần API sai là
   ban oan người thật.
10. **AI kiểm duyệt nội dung** — chi phí mỗi tin nhắn, độ trễ, và tiếng Việt có dấu vẫn là
    điểm yếu của phần lớn model kiểm duyệt. `automod-rules.ts` xử lý được 90% ca thực tế với
    0 đồng.
