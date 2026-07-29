# Nhật báo map-reduce 3h + Knowledge + Plugin/Config builder

Status: **Phase 01→06 xong code, `npm run build` sạch (exit 0). Còn lại là việc cấu hình ở phía Saly: push workflow + đặt secret.**
Ngày: 2026-07-28 (cập nhật 2026-07-29)
Codebase: `D:\Project\.3_STELL_BOT`

## Việc Saly cần chạy trước khi deploy

Đã xong hết phần build: `npx prisma generate`, `npx prisma migrate deploy`, và
`npm run build` (`tsc` exit 0 sau khi thêm phase 06 + backfill + sửa Java/Kotlin).

Không cần `npm install` — cả phase 05 và 06 được thiết kế để không thêm thư viện nào
(phase 06 chỉ gọi HTTP tới GitHub, không compile gì ở host).

Còn lại 2 việc cấu hình, thiếu thì `/plugin` vẫn chạy nhưng chỉ trả mã nguồn:

1. Push `.github/workflows/build-plugin.yml` lên repo dùng làm máy build. Workflow
   phải có mặt trên nhánh `PLUGIN_BUILD_REF` (mặc định `main`) TRƯỚC khi gọi, vì
   `workflow_dispatch` trả 404 nếu GitHub chưa thấy file.
2. Đặt `PLUGIN_BUILD_REPO` (`owner/repo`) và `PLUGIN_BUILD_TOKEN` (PAT có quyền
   `actions:write`).

Chi tiết kiến trúc + rủi ro: [advisory-kien-truc-va-rui-ro.md](advisory-kien-truc-va-rui-ro.md)

## Kết luận ngắn

| Yêu cầu | Đánh giá | Chặn? |
|---|---|---|
| Nhật báo 3h → gom 8 lần → 1 bản 24h | Đúng hướng. Sửa được ngay | Không |
| Đọc ảnh (vision) | **Đã probe 2026-07-29: chạy được.** Model trả đúng nội dung ảnh gửi qua URL https | Không |
| Web research | Làm được, code tự fetch (chọn vậy để chặn SSRF, không phải vì gateway thiếu tool) | Cần chọn search API |
| Knowledge từ kênh hỏi-đáp | Làm được, cần gate chống troll | Không |
| Ping Saly gợi ý sản phẩm | Dễ | Cần user ID của Saly |
| `/plugins` → build jar | Build ở GitHub Actions, host chỉ gọi HTTP. Java thuần, không Kotlin | Không (đã mở) |
| `/config` sửa zip/yaml | Làm được, cần chống zip-slip + lọc secret | Không |

## Nguyên nhân thật của "không đủ context"

Không phải do AI yếu. Do code cắt dữ liệu:

`reportManager.ts:119` — `chat.slice(0, 8000)`.

6 kênh × 200 tin × 300 ký tự = tối đa ~360.000 ký tự, bị cắt còn 8.000 → mất ~97% chat ngày bận.
Cộng thêm `maxTokens: 1200` (output ngắn) và cap 2 trang/kênh (`reportManager.ts:46`) làm mất tin trước cả khi cắt.

Nên đề xuất 3h của Saly đúng về bản chất: mỗi lượt chỉ xử lý 1/8 lượng chat → đọc **full fidelity** thay vì slice. Đây là map-reduce, không chỉ là "chia nhỏ".

## Phases

| # | Nội dung | Trạng thái | Rủi ro | Phụ thuộc |
|---|---|---|---|---|
| 01 | Map-reduce 3h + lưu chunk vào DB | Build xong | Thấp | — |
| 01b | Backfill slot mất + dọn dữ liệu cũ mỗi ngày | Code xong, **chưa build** | Thấp | 01 |
| 02 | Glossary/Knowledge + hỏi kênh knowledge | Build xong | Trung (troll, injection) | 01 |
| 03 | Vision đọc ảnh + web research | Build xong | Trung (cost, SSRF) | 01 |
| 04 | Ping chủ server gợi ý sản phẩm | Build xong | Thấp | 01 |
| 05 | `/config` sửa file config | Build xong | Trung (secret) | — |
| 06 | `/plugin` viết **mã nguồn** plugin | Build xong | Thấp (không compile/chạy) | — |
| 06b | Build jar qua GitHub Actions | Code xong, **chưa build** | Trung (sandbox GitHub + review bắt buộc) | Push workflow + PAT |

"Build xong" = đã qua `npm run build` Saly chạy ở phiên trước. 01b và 06b viết sau
lần build đó nên chưa qua `tsc` lần nào.

### Phase 05: đổi phạm vi so với kế hoạch gốc

Kế hoạch gốc là nhận **zip**. Đã đổi thành **1 file text**, vì:

- Bỏ zip = bỏ luôn zip-slip + zip-bomb (2 rủi ro lớn nhất của phase này), không cần code chống.
- Không cần thêm `adm-zip` / `yaml` vào `package.json` — không phải cài gì.
- File đi qua dạng **text**, không parse YAML rồi ghi lại: giữ nguyên comment + định dạng.
  Nếu parse lại thì sửa 1 dòng cũng trả về diff toàn file, không review nổi.

Đổi lại: mỗi lượt sửa 1 file. Với nhu cầu thật ("đổi max-players thành 50") thì đủ.

### Phase 03: làm được mà KHÔNG cần probe trước

Ban đầu tưởng phải probe gateway mới viết được. Thực ra không:

- Định dạng multimodal `image_url` là **chuẩn OpenAI có tài liệu**, không phải đoán.
- `aiClient.askAI` giờ tự **thử lại bằng text** khi gateway từ chối payload có ảnh
  (4xx hoặc 200 rỗng). Gateway không nhận ảnh → nhật báo vẫn ra như cũ, không mất slot.

Probe đã chạy 2026-07-29 và **xác nhận vision hoạt động**: gửi ảnh dạng URL https, model
trả đúng nội dung ảnh ("Pig face"). Đây đúng là đường bot dùng — ảnh Discord luôn là link
CDN, không bao giờ nhúng base64. Riêng `data:` URL thì gateway từ chối (`param: "input"`),
nhưng không ảnh hưởng: code không dùng dạng đó. Nhánh fallback-về-text vẫn giữ, giờ nó là
lưới an toàn thật sự chứ không phải đường chạy chính.

Probe còn lộ một điều đáng ghi: **gateway tự đi tải ảnh**, không phải mình gửi byte lên.
Lần thử đầu dùng ảnh Wikipedia trả `param: "url"` + "Error while downloading file. Upstream
status code: 400" — tức là gateway có đọc đúng khuôn multimodal rồi mới thất bại ở bước tải.
Hệ quả cho bot: link ảnh phải còn sống VÀ cho phép máy lạ tải về ở thời điểm gọi AI. Link
Discord CDN mang tham số chữ ký `?ex=&is=&hm=` và có hạn, nên khung 3h bình thường thì thoải
mái (tóm tắt chạy ngay sau khi khung đóng), còn `runBackfill` vá khung cũ 18h trước thì ảnh
có thể đã hết hạn. Không phải lỗi cần sửa: ảnh vốn là phần phụ, và `collectChunkImages` chỉ
đọc 1 trang mới nhất nên backfill gần như luôn nhận mảng rỗng — bản tóm tắt văn bản không
phụ thuộc vào nó.

Web research: **code tự fetch**, model không được chọn URL. Probe 2026-07-29 cho thấy
gateway CÓ nhận `tools` và trả `tool_calls` thật — nên đây là lựa chọn có chủ ý, không
phải hạn chế của gateway: để model tự chọn URL là mở đường SSRF cho bất cứ thứ gì member
gõ vào chat. Chủ đề tra chọn **không tốn AI call** — lấy từ glossary đã học (danh từ cụ
thể, gắn với nhu cầu thật). Tắt hoàn toàn khi thiếu `RESEARCH_API_KEY`.

Guard SSRF đã tách ra `src/utils/safe-public-url.ts` (trước nằm trong `aiQaManager`), giờ
2 nơi dùng chung 1 bản — advisory yêu cầu đúng chỗ này.

### Phase 06: tách làm 2 — sinh code, rồi build ở nơi khác

Yêu cầu gốc gộp 2 việc khác nhau về mức rủi ro: **sinh code** và **build + phát jar**.
Đã tách ra: phần sinh code chạy trong bot, phần build đẩy ra khỏi máy bot hoàn toàn.

**Đã làm — `/plugin` trả mã nguồn** (`plugin-source-generator.ts`, `commands/plugin-source.ts`):
member mô tả tính năng → Stella trả về `plugin.yml` + class dạng file `.md` để member tự build.
Không compile, không chạy, không phát jar dưới tên studio. Prompt tự từ chối yêu cầu độc
(phá server, lấy mật khẩu người chơi, chạy lệnh hệ thống, bypass anticheat) bằng cách trả
`KHONG_AN_TOAN`. Embed nói rõ code do AI viết và cần đọc lại trước khi chạy thật.

Đây là phần **có giá trị thật** của yêu cầu: member vẫn được giúp, mà người thật đọc code
trước khi nó chạy ở đâu đó.

**Đã mở — build jar qua GitHub Actions** (Saly chốt 2026-07-29: dùng hosting, không dùng máy
local). Máy local Java 8 và shared hosting SFTP đều không có JDK, build Gradle ăn 1-2GB RAM sẽ
giết bot — nên **không có gì được compile trên máy bot**. Bot chỉ nói HTTP với GitHub:

```
/plugin → AI sinh code → parse file → base64 → workflow_dispatch
       → runner ephemeral của GitHub build → artifact jar → bot tải về → DM Saly review
```

Runner ephemeral chính là sandbox: code do AI sinh chạy trong máy dùng một lần của GitHub,
không phải máy có token/DB của bot. Mỗi build có log truy vết trên GitHub.

Hai bất biến của `.github/workflows/build-plugin.yml`, viết rõ trong file:

1. **Gradle script do workflow tự viết**, không bao giờ lấy từ payload. Nếu để payload đưa
   `build.gradle` vào thì `apply from:` là RCE ngay trên runner.
2. **Text từ payload chỉ đi qua `env:`, không bao giờ nhúng inline `${{ }}` trong `run:`** —
   `${{ }}` là thay thế văn bản, một dấu `"` trong tên plugin là thoát ra shell.

Lọc file 3 lớp: whitelist đuôi (`.java`/`.yml`/`.yaml`), chặn tên trùng `BUILD_SCRIPTS`,
và `path.resolve` + kiểm tra prefix chống traversal.

**Java thuần, không Kotlin.** Build script trong workflow chỉ khai `id 'java'`, runner không có
toolchain Kotlin. Nếu để `.kt` lọt qua thì Gradle copy vào, **không biên dịch, vẫn báo thành
công** — jar thiếu code mà vẫn ghi tên studio. Nên `.kt` bị chặn ở 3 chỗ độc lập: prompt yêu cầu
Java, parser nhận ra tên `.kt` rồi đẩy vào `skipped` (khiến cổng build đóng), runner `exit 1` nếu
vẫn thấy `.kt`. Parser cố tình **vẫn match** `.kt` ở `NAME_LINE` — bỏ match thì file thành vô
hình, `skipped` rỗng, cổng build mở lại và jar lại thiếu code.

Cap 12 file / 24KB mỗi file / 45KB tổng. Con số 45KB **không phải mình chọn**: mỗi input của
`workflow_dispatch` tối đa 65.535 ký tự, payload đi dạng base64 nên phình 4/3 → nguồn thô phải
dưới ~49KB. Vượt trần thì client trả `payload-too-big` **trước khi** gọi GitHub, vì GitHub chỉ
trả 422 trơn không nói gì về kích cỡ — lẫn luôn với sai `ref` hoặc thiếu workflow.

**Review vẫn bắt buộc mặc định** (`PLUGIN_BUILD_REVIEW`, fail-closed): jar DM cho Saly, member
chỉ nhận thông báo đang chờ duyệt. Thiếu `OWNER_USER_ID` thì không phát jar cho ai — jar ghi
`author: SalyVn` mà chưa ai đọc code là rủi ro danh tiếng. Muốn phát trực tiếp thì đặt
`PLUGIN_BUILD_REVIEW=off`.

Artifact gửi nguyên dạng `.zip` GitHub trả về, không giải nén — bỏ luôn zip-slip. Token
không bao giờ gửi kèm khi tải từ URL storage đã ký (`redirect: 'manual'`), và chỉ status code
được log (body lỗi của GitHub có thể vọng lại nội dung request).

**Gate rate-limit dùng chung.** `/config` và `/plugin` đều là lệnh AI đắt (bắt model xuất cả
file). Logic gate tách ra `ai-slot-gate.ts` (factory), 2 lệnh chỉ khai báo hạn mức riêng —
trước đó `/config` có bản copy riêng, nhân thêm lệnh nữa là nhân thêm bug.

## Acceptance criteria

- Phase 01: 8 chunk/ngày lưu DB, không post public; bản 24h dùng đủ 8 chunk; không double-post khi restart giữa chừng; ngày chết (không chat) không post.
- Phase 01 (backfill + dọn dữ liệu): slot mất do bot offline được vá trước 21h, tối đa 2 slot/tick; slot hết quota trang lịch sử **không** bị ghi rỗng (ghi rỗng = đóng dấu "ngày yên tĩnh" vĩnh viễn cho khung đang bận); sau khi post bản 24h thì xoá chunk + khoá idempotency cũ hơn `retentionDays`, chỉ trong phạm vi `kind` của nhật báo vì `MaintenanceLog` là bảng dùng chung.
- Phase 02: thuật ngữ lạ được hỏi ở kênh chỉ định, cap ≤5 term/lượt; chỉ lưu khi người **có role tin cậy** trả lời; bản tin sau đó dùng được term đã lưu; không hỏi lại từ đã biết.
- Phase 03: ảnh chỉ đọc từ kênh whitelist, cap N ảnh/lượt; web fetch dùng lại guard SSRF sẵn có.
- Phase 04: chỉ ping đúng chủ server (`allowedMentions` giới hạn), tắt khi thiếu `OWNER_USER_ID`, ngày không có nhu cầu thì không post.
- Phase 05: file >256KB bị từ chối; secret được thay placeholder TRƯỚC khi gửi AI và khôi phục sau; nếu AI làm mất placeholder thì **không** trả file.
- Phase 06 (sinh mã nguồn): `/plugin` trả file mã nguồn; yêu cầu độc bị từ chối (`KHONG_AN_TOAN`); cap 1 lượt/toàn server, cooldown 120s/người.
- Phase 06 (build jar): thiếu `PLUGIN_BUILD_REPO`/`PLUGIN_BUILD_TOKEN` thì chỉ trả mã nguồn, không báo lỗi cho member; build script nằm trong workflow chứ không lấy từ payload; file `build.gradle`/`settings.gradle`/`gradlew` trong payload bị bỏ; đuôi ngoài `.java`/`.yml`/`.yaml` bị bỏ; file `.kt` làm **hỏng cả lượt build** (không im lặng bỏ qua) vì runner chỉ biên dịch Java, bỏ qua sẽ ra jar thiếu code mà vẫn báo thành công; tên có `..` hoặc thư mục bị chuẩn hoá; payload base64 vượt 65.535 ký tự bị chặn tại client kèm lý do rõ, không để GitHub trả 422 trơn; jar >8MB bị từ chối; một lượt poll hụt (rate-limit, mất mạng) **không** làm mất run đã tìm được — nếu không thì build chạy xong vẫn báo `run-not-found` và member mất link log; mặc định jar DM cho Saly, member chỉ nhận thông báo chờ duyệt; thiếu `OWNER_USER_ID` khi review bật thì không phát jar cho ai; mọi lỗi build chỉ là `followUp` thêm, không biến câu trả lời mã nguồn đã gửi thành thông báo lỗi.

## Modularization

`reportManager.ts` đã 258 dòng (>200, vượt ngưỡng CLAUDE.md). Không nhồi thêm. Tách:

```
src/systems/report/
  report-scheduler.ts              # tick, slot math, khoá idempotency
  report-chunk-collector.ts        # gather 3h (chat/ảnh/web)
  report-chunk-summarizer.ts       # 1 AI call/chunk
  report-daily-composer.ts         # reduce 8 chunk -> bản cuối
  report-publisher.ts              # postReport + splitForEmbed (bê từ file cũ)
src/systems/knowledge/
  glossary-store.ts                # CRUD term
  glossary-term-detector.ts        # phát hiện từ lạ
  glossary-question-asker.ts       # hỏi kênh + thu câu trả lời
src/systems/builder/
  plugin-source-generator.ts       # phase 06: 1 AI call -> mã nguồn
  plugin-source-file-parser.ts     # phase 06: bóc file từ fence + lọc tên/đuôi/kích cỡ
  plugin-build-client.ts           # phase 06b: dispatch + poll + tải artifact (chỉ HTTP)
  config-patch-service.ts          # phase 05
```

Tên thật khác kế hoạch gốc (`kotlin-plugin-builder.ts`): việc build không nằm ở
process bot nữa nên không có "builder" nào chạy local — chỉ có 1 client gọi GitHub.

## Biến môi trường

Thêm vào `.env` (không commit):

```
AI_API_KEY=...          # thiếu key => TOÀN BỘ tính năng AI tắt, nhật báo trả 'disabled'
OWNER_USER_ID=...       # Discord user id của Saly; thiếu thì phase 04 tự tắt
PLUGIN_BUILD_REPO=...   # owner/repo chứa .github/workflows/build-plugin.yml
PLUGIN_BUILD_TOKEN=...  # PAT quyền actions:write trên repo đó
PLUGIN_BUILD_REF=main   # nhánh chạy workflow (mặc định main)
PLUGIN_BUILD_REVIEW=on  # 'off' mới phát jar trực tiếp cho member
```

Thiếu `PLUGIN_BUILD_REPO` hoặc `PLUGIN_BUILD_TOKEN` thì `/plugin` vẫn chạy, chỉ là
dừng ở mã nguồn — không có lỗi hiện ra cho member.

`.github/workflows/build-plugin.yml` phải được push lên repo `PLUGIN_BUILD_REPO`
trước, nếu không `workflow_dispatch` trả 404.

## Câu hỏi chưa giải quyết

1. ~~**Host build jar ở đâu?**~~ **Đã chốt 2026-07-29: GitHub Actions.** Saly dùng hosting, không dùng máy local này. Host bot chỉ gọi HTTP tới GitHub — không cần JDK/Gradle, không tốn RAM của bot.
2. ~~**Jar do AI sinh có được Saly review trước khi gửi member không?**~~ **Đã chốt: BẮT BUỘC review** (`PLUGIN_BUILD_REVIEW` mặc định bật, fail-closed).
3. ~~**Gateway có nhận ảnh + có search không?**~~ **Đã probe 2026-07-29** trên gateway đang chạy thật (`router.keepmeside.live`, model `cx/gpt-5.6-sol(max)`):
   - **Vision: CÓ**, nhưng chỉ qua **URL https**. Ảnh dạng `data:image/png;base64,...` bị trả 400 `param: "input"` ("does not represent a valid image"); cùng ảnh đưa bằng link https thì trả 200 và model mô tả đúng nội dung ("Pig face"). Đây đúng là đường bot đang dùng — `report-image-collector.ts` gửi link Discord CDN, không bao giờ inline base64. Vậy phase 03 chạy được như đã viết.
   - **Tool-calling: CÓ.** Gateway nhận trường `tools` và trả `tool_calls` thật (`web_search` kèm `arguments`). Trái với advisory ban đầu. **Không đổi thiết kế web research**: code vẫn tự search + tự fetch, vì cho model tự chọn URL là mở SSRF cho text member viết ra, và `aiClient` xoá tool-call XML là để giữ giọng Stella, không phải vì gateway thiếu tool. Ghi lại đây để sau này không ai "sửa" theo một giả định đã sai.
   - Lưu ý khi probe lại: gateway rate-limit bằng cách trả **lỗi cũ đã cache** kèm `(reset after Ns)`, nên gọi liên tiếp sẽ khiến mọi case thừa hưởng lỗi của case đầu — kể cả case không gửi ảnh. Script đã chèn `sleep(15s)` giữa các lần gọi vì lý do này.
4. ~~**Chunk bị mất khi bot offline qua mốc slot có cần backfill không?**~~ **Đã làm 2026-07-29:** `runBackfill` chạy sau mỗi tick, dò 8 slot của bản tin ngày, vá tối đa 2 slot/lượt (`maxSlotsPerRun`), mới nhất trước. Đi ngược history nên cấp 40 trang/kênh thay vì 6. Nếu hết hạn mức trang mà chưa tới đầu khung thì **không** ghi chunk rỗng (`reachedStart`) — ghi rỗng là đóng dấu vĩnh viễn "khung này im lặng" cho một buổi tối đang bận.
