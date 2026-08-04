# Advise — Stella từ "bot trả lời" thành "thành viên có mặt"

Ngày: 2026-08-04 | Repo: Stella-Bot (`D:\Project\.3_STELL_BOT`) | Nhánh: main

## Bài toán (reframed)

Bot đã trưởng thành: 34 Prisma model, 9 hệ thống cộng đồng, nhật báo AI map-reduce chạy ổn. Nhưng **Stella bị động**: chỉ nói khi bị gọi (`!s`, `/ask`), không thấy ảnh người gửi dù gateway hỗ trợ vision, không tự khởi chuyện, không dùng `MemberFact` đã tích để làm gì ngoài nhồi vào prompt QA. Mục tiêu: Stella thành thành viên **có mặt** — thấy được thứ người ta gửi, chủ động kết nối người với người, dẫn sự kiện.

## Yêu cầu (chốt qua phỏng vấn)

1. Stella nhìn được ảnh trong chat (không chỉ trong report pipeline)
2. Stella chủ động kết nối người với người dựa trên `MemberFact`
3. Stella dẫn được sự kiện / nhập vai NPC
4. Quy mô 30-100 active/ngày
5. Gateway miễn phí → không tối ưu token, nhưng **phải** chống spam/rate-limit
6. Không làm: kinh tế mới, game mới, hệ thống mới từ đầu

## Quyết định của user (2026-08-04, sau phỏng vấn vòng 2)

1. **Mục kết nối: NÊU TÊN THẬT** → cần opt-out riêng, bắt buộc.
2. **`expertScore`: user không chắc → tôi đã verify và tự quyết.** Xem "Sửa lại kết luận" bên dưới.
3. **Sự kiện AI CÓ thưởng scoin, kèm thêm nhiều chỗ tiêu**: mở rộng shop, tiêu vào chính sự kiện (vòng khép kín), chợ/đấu giá giữa người chơi, **và bán sản phẩm thật của owner bằng scoin: plugin owner tự dev, docs, vé giveaway.**

## Quyết định vòng 3 (2026-08-04) — CHỐT

1. **Chống alt: KHÔNG đặt mức tối thiểu.** User quyết. Xem "Đánh giá lại rủi ro alt" dưới đây — rủi ro thấp hơn tôi nói ban đầu, nhưng vẫn ghi lại như trade-off có ý thức.
2. **Không giới hạn số lượng** plugin/docs.
3. **BỎ chợ/đấu giá giữa người chơi khỏi scope.** (Đồng ý — đây là hướng rủi ro nhất và không phải sink thật.)

## Đánh giá lại rủi ro alt — nhẹ hơn tôi nói ban đầu

Tôi đã cảnh báo alt account khi bán hàng thật. Nhưng hai quyết định của bạn vừa **tự triệt tiêu phần lớn rủi ro đó**:

- **Bỏ chợ giữa người chơi** → alt **không chuyển được xu** cho nick chính. Đây là mắt xích quan trọng nhất của mọi kịch bản farm. Không có chợ thì mỗi alt chỉ tự tích xu cho chính nó, mà alt thì chẳng cần plugin.
- **Giao hàng thủ công** (bạn tự gửi plugin/docs) → **bạn thấy mặt từng người mua**. Đây là chốt kiểm tra tự nhiên, mạnh hơn mọi rule tự động: thấy nick lạ mới tạo đòi plugin thì bạn biết ngay.

→ **Không cần mức tối thiểu là quyết định hợp lý trong bối cảnh này.** Tôi rút lại mức độ cảnh báo ban đầu; nó đúng cho trường hợp "có chợ + giao tự động", không đúng cho thiết kế bạn vừa chọn.

Trade-off còn lại (nhỏ, chấp nhận được): nếu sau này bạn **tự động hoá việc giao hàng** hoặc **mở chợ**, rủi ro alt quay lại ngay — lúc đó mới cần cổng chặn. Ghi lại để nhớ, không phải việc phải làm bây giờ.

**Không giới hạn số lượng**: hợp với hàng số (plugin/docs copy vô hạn, không tốn thêm gì). Đúng lựa chọn. Chỉ cần **giá đủ cao** để xu có sức nặng — vì không còn khan hiếm về số lượng thì giá là đòn duy nhất điều tiết.


Scout vòng 1 báo "expertScore không có writer" — **sai**. Đã verify bằng grep toàn repo:

- `voteManager.ts:107` + `:194` — `expertScore: { increment: delta.expert }`, tăng khi bài trong kênh chuyên môn được vote up (`scoreDelta` phân loại theo `channelId`)
- `voteBackfillManager.ts:315-327` — tính lại toàn bộ từ showcase vote count, reset về 0 cho ai không còn trong danh sách

→ **Không bỏ, không viết writer mới. Nó đã chạy đúng.** Việc duy nhất cần làm: xác nhận danh sách kênh trong `scoreDelta` còn khớp với cấu trúc kênh hiện tại của server (nếu kênh chuyên môn đã đổi ID thì điểm ngừng tăng mà không ai biết).

Bài học: scout grep hẹp (chỉ `requestManager`) ra kết luận sai. Đã sửa trước khi khuyên.

## Phát hiện thứ 2 — hạ tầng bán hàng ĐÃ CÓ SẴN

Ý "bán plugin/docs bằng scoin" nghe như hệ thống mới, nhưng repo đã có gần hết:

- `Giveaway.entryCost` (`giveawayManager.ts:174`) — **đã thu scoin để tham gia, đã hoàn tiền khi huỷ**. Ý "scoin để tham gia giveaway" = đã xong, chỉ cần dùng.
- `deliverGiveawayRewards` (`:307`) + model `GiveawayRewardDelivery` — **đã có đường giao phần thưởng cho người thắng, có trạng thái giao hàng**. Đây chính là thứ cần để giao plugin/docs sau khi mua.
- `ShopPurchase` (`schema.prisma:402`) — có `itemKey`, `price`, `userId`, `createdAt`. **Đủ để làm sổ đơn hàng**, đang bị ghi mà không đọc.

→ Bán plugin/docs = `ShopPurchase` (sổ đơn) + mô hình giao hàng của `GiveawayRewardDelivery`. Không cần model mới.


Ba tính năng bạn chọn **chênh lệch chi phí gấp ~10 lần** nhưng bạn chọn cả ba như thể ngang nhau. Xếp đúng thứ tự:

- **Vision trong chat**: gần như đã xong. `askAI` đã nhận `image_url` parts (`aiClient.ts`), `report-chunk-summarizer` đã dùng. `aiQaManager` chỉ **không forward** attachment. Đây là nối dây, không phải tính năng mới. **Làm ngay.**
- **Chủ động kết nối người**: giá trị cao nhất nhưng **rủi ro xã hội cao nhất**. Bot tag hai người "hai bạn cùng thích redstone, nói chuyện đi" mà sai ngữ cảnh thì nó là bot spam, không phải thành viên. Cần gate chặt.
- **AI dẫn sự kiện / NPC**: hệ thống mới hoàn chỉnh (state máy, lượt chơi, phần thưởng, chống lạm dụng). Đây là dự án riêng, không phải "thêm tính năng". **Đừng làm cùng lúc với hai cái trên.**

Cảnh báo thẳng: gateway miễn phí làm bạn tưởng chi phí bằng 0. Chi phí thật của tính năng chủ động **không phải token — là sự kiên nhẫn của thành viên**. Bot nói sai lúc còn tệ hơn bot im lặng.

## Nên làm (thứ tự)

### 1. Vision trong chat QA — nhỏ, làm trước
Ở `aiQaManager`, đọc `message.attachments`, lọc `contentType` ảnh + host Discord CDN (`report-image-collector` đã có whitelist logic — DRY, tái dùng), truyền vào `askAI` như multimodal parts. Giới hạn 1-2 ảnh/câu.

Giá trị thực với server Minecraft: gửi ảnh build → góp ý; gửi ảnh crash log → đọc giúp. Đây là dùng đúng thế mạnh của cộng đồng bạn.

### 2. Nhật báo có ảnh người thật → dùng lại vision (miễn phí thêm)
`report-image-collector` đã gom ảnh. Vision đã hoạt động. Nên bản tin mô tả được "hôm nay Long khoe farm gà 3 tầng" thay vì chỉ text — nếu chưa làm thì đây là đường ngắn nhất tăng chất lượng báo.

### 3. Chủ động kết nối — bản KHIÊM TỐN trước
Không tag người giữa chat. Làm ngược lại: **thêm mục "GỢI Ý KẾT NỐI" vào nhật báo 21h**, dạng "Ai thích redstone: Long, Minh, Tèo — có thể lập nhóm". Lý do:
- Nhật báo là kênh **đã được chấp nhận** để Stella nói dài
- Sai thì vô hại (mục nhỏ trong báo), không phải ping vào mặt ai
- Đo được: có ai hưởng ứng không → rồi mới quyết định có nâng lên proactive ping

Chỉ khi mục này chứng minh có người hưởng ứng, mới nâng cấp thành ping trực tiếp có opt-in.

### 4. Sự kiện AI — chỉ sau khi 1-3 sống được
Bản nhỏ nhất đáng làm: **1 sự kiện/tuần, do owner bấm nút mở**, Stella dẫn 1 màn kể chuyện có 3-4 lượt chọn cho cả server vote, thưởng scoin cho người tham gia. Không state máy phức tạp, không NPC bền, không nhập vai tự do.

## Không nên làm

- **Đừng cho Stella tự do ping người giữa chat ngay** — chưa có bằng chứng ai muốn. Bot chủ động sai là đường nhanh nhất để người ta mute bot.
- **Đừng xây NPC "nhập vai tự do"** — không có điều kiện thắng, dễ trôi thành chatbot vô nghĩa, và người ta sẽ thử jailbreak nhân vật ngay ngày đầu.
- **Đừng lôi `MemberFact` ra dùng chủ động mà không có đường TẮT rõ ràng.** Đang có `/stella quên-tôi`, nhưng "bot nhớ tôi" và "bot đem chuyện của tôi ra nói với người khác" là hai mức đồng thuận khác nhau. Cần opt-in riêng.
- **Đừng làm cả ba song song** — ba cái đụng cùng `aiQaManager` + prompt, merge sẽ đau.

## Có thể tốt hơn / rẻ hơn

Xếp theo effort-to-impact (cao nhất trước):

1. **Vision chat** — nối dây, tác động tức thì
2. **Mục kết nối trong nhật báo** — tái dùng composer, rủi ro gần 0
3. **Sửa các lỗ scout tìm ra** — `expertScore` luôn = 0 nhưng vẫn hiện trong `/profile`, `/stats`, `/top` (người dùng thấy số 0 vô nghĩa); `TriviaWin` table chết hoàn toàn; `ShopPurchase` chỉ ghi không đọc. Đây không phải tính năng mới nhưng **rẻ hơn và sửa được thứ người dùng đang thấy sai**.
4. **Showcase / job board lên nhật báo** — hiện thắng showcase không lên báo trừ khi có người tình cờ chat về nó. Nối `showcaseManager` + `requestManager` vào composer là việc nhỏ, làm mọi thành tích được công nhận công khai.
5. Sự kiện AI — để sau

## Đánh giá riêng của tôi

Bạn hỏi "nghĩ thêm tính năng" nhưng thứ bot bạn thiếu **không phải thêm tính năng** — là **nối và dọn những gì đã có**. Bằng chứng: `config.digest` chết hoàn toàn, `expertScore` không ai ghi mà vẫn hiện cho người dùng, vision đã trả tiền/đã hoạt động mà chat không dùng, showcase thắng mà báo không biết. Server 30-100 người sẽ cảm nhận 4 thứ đó rõ hơn một hệ thống NPC mới.

Đường đi tôi khuyên: **Vision chat → mục kết nối trong báo → dọn 3 lỗ dữ liệu → nối showcase/job vào báo**. Sự kiện AI làm sau, như dự án riêng có plan riêng.

## Tư vấn về chỗ tiêu xu (vòng 2)

Bạn chọn 4 hướng. Chúng **không ngang nhau về rủi ro** — xếp lại:

### Nên làm, theo thứ tự

**1. Vé giveaway bằng scoin — ĐÃ XONG, chỉ cần dùng.** `entryCost` có sẵn, có hoàn tiền khi huỷ. Đặt `entryCost > 0` cho giveaway tới là có sink ngay hôm nay, 0 dòng code. Đây là sink **thật** (xu biến mất khỏi hệ thống).

**2. Mở rộng shop — rẻ nhất, dùng `shop-manager` sẵn.** Thêm item vào catalog: role danh hiệu, XP boost, slot showcase ưu tiên. Sink thật. Kèm việc **đọc `ShopPurchase`** (`/shop history`) — đang ghi mà không đọc.

**3. Bán plugin/docs của bạn bằng scoin — hay nhất về mặt ý tưởng, nhưng đọc kỹ cảnh báo dưới.** Đây là sink mạnh nhất vì hàng có giá trị thật ngoài game. Dùng `ShopPurchase` làm sổ đơn + mô hình `GiveawayRewardDelivery` để giao.

**4. Tiêu vào chính sự kiện AI (vòng khép kín)** — làm cùng lúc với sự kiện, không trước.

### Cảnh báo thật về hai hướng cuối

**Bán plugin/docs bằng scoin — đây là chỗ tôi phải nói thẳng:**

Khi xu mua được **hàng có giá trị thật ngoài Discord**, xu ngừng là điểm vui và thành **tiền**. Hệ quả bạn phải chuẩn bị:

- **Alt account / farm xu sẽ xuất hiện ngay.** Hiện có 8 nguồn kiếm gồm daily streak, message XP, vote — tất cả đều farm được bằng nick phụ. Trước khi bán hàng thật, cần: chặn alt (kiểm tra tuổi account/role), hoặc chỉ cho mua khi đạt level/tuổi thành viên tối thiểu.
- **Người ta sẽ đòi hỏi công bằng.** Hôm nay bạn tặng plugin cho ai đủ xu; mai có người tiêu hết xu mà bạn hết hàng, hoặc bạn đổi giá — sẽ có tranh cãi. Cần: giá niêm yết rõ, số lượng giới hạn công bố trước, và **không hoàn xu sau khi giao** (ghi rõ từ đầu).
- **Đừng để đổi ngược xu ↔ tiền thật.** Bán hàng-của-bạn lấy xu thì ổn. Nhưng nếu có người bán xu lấy tiền thật giữa các thành viên, bạn đang vô tình vận hành sàn tiền tệ trong Discord — rắc rối cả về ToS lẫn về người.

**Chợ/đấu giá giữa người chơi — hướng rủi ro nhất trong 4 cái:**

- Đây **không phải sink thật** — xu chỉ chuyển tay, tổng cung không giảm. Nó tạo lý do kiếm xu, tức là làm lạm phát **tệ hơn**, trừ khi bạn thu phí giao dịch (phí mới là sink).
- Cộng với việc bán hàng thật ở trên → alt account chuyển xu cho nick chính là con đường farm rõ ràng nhất.
- Nếu vẫn làm: **thu phí giao dịch** (5-10%), giới hạn số lần chuyển/ngày, log mọi giao dịch, và làm **sau** khi đã có chống alt.

### Về "có thưởng scoin" cho sự kiện AI

Bạn chọn có thưởng — tôi đồng ý **với điều kiện** thưởng đến từ **xu đã bị tiêu vào chính sự kiện đó**, không phải xu in mới. Cụ thể: người tham gia mua vé → tiền vé vào giải thưởng → người thắng nhận. Vòng khép kín, tổng cung không tăng. Nếu thưởng bằng xu in mới thì bạn vừa thêm faucet thứ 9 trong khi đang lạm phát.

### Đường đi cho phần kinh tế

Vé giveaway (0 code) → mở rộng shop + đọc `ShopPurchase` → **chống alt** → bán plugin/docs → *(cuối, nếu vẫn muốn)* chợ có phí giao dịch.

Chống alt phải nằm **trước** bán hàng thật. Đây là thứ tự không nên đảo.


- Stella "thấy" được thứ cộng đồng Minecraft quan tâm nhất (ảnh build, ảnh lỗi) — đúng thế mạnh server
- Kết nối người diễn ra trong kênh đã được chấp nhận, không gây phiền
- Mọi thành tích (showcase, job) được công nhận công khai → động lực tham gia
- Không thêm hệ thống phải bảo trì; phần lớn là nối dây và dọn

## Trade-off (thật lòng)

- **Bạn chọn cả 3 tính năng, tôi khuyên hoãn cái thứ 3.** Nếu bạn vẫn muốn sự kiện AI trước, được — nhưng nó cần plan riêng và sẽ chiếm gần hết thời gian; hai cái kia sẽ đứng im.
- Mục kết nối trong báo **nhạt hơn** ping trực tiếp. Đổi lại: không có rủi ro làm người ta khó chịu. Đây là đánh đổi có ý thức.
- Vision chat mở đường cho người gửi ảnh rác để trêu bot → cần cooldown, giới hạn ảnh/câu.
- Dọn `expertScore`/`TriviaWin`/`ShopPurchase` không "vui" như tính năng mới, nhưng đang là thứ hiển thị sai cho người dùng.

## Work checklist

**Đợt 1 — Stella có mặt (làm trước, độc lập với kinh tế)**
- [ ] `aiQaManager`: đọc `message.attachments`, lọc ảnh + Discord CDN host (tái dùng whitelist của `report-image-collector`), truyền multimodal vào `askAI`; giới hạn 1-2 ảnh/câu
- [ ] Cooldown riêng cho câu hỏi kèm ảnh (chống spam ảnh trêu bot)
- [ ] Test: ảnh build → mô tả đúng; ảnh ngoài Discord CDN → bỏ qua, không lỗi
- [ ] Nhật báo: mục "GỢI Ý KẾT NỐI", **nêu tên thật** (user đã chốt), nhóm theo sở thích chung từ `MemberFact` — chỉ nêu sở thích chung, không nêu chi tiết riêng tư
- [ ] **Opt-out riêng cho việc bị nêu tên** (bắt buộc — khác `/stella quên-tôi`; "nhớ tôi" ≠ "đem tôi ra nói với người khác")

**Đợt 2 — Dọn (rẻ, sửa thứ user đang thấy sai)**
- [ ] `expertScore`: KHÔNG bỏ, KHÔNG viết writer — chỉ **xác nhận danh sách kênh trong `voteManager.scoreDelta` còn khớp cấu trúc kênh hiện tại**
- [ ] `TriviaWin` model chết: xoá khỏi schema + migration, hoặc chuyển cap trivia sang dùng nó thay vì đếm `ScoinTransaction` (ledger bị prune sẽ reset cap ngầm)
- [ ] Xoá `config.digest` chết khỏi `config.ts`
- [ ] Dọn `tmp_steal.ts`, `tmp_panel_state.json` ở gốc repo
- [ ] Nối `showcaseManager` (bài thắng vote) + `requestManager` (job xong) vào `gatherServiceBoard` → lên nhật báo

**Đợt 3 — Kinh tế (thứ tự KHÔNG đảo)**
- [ ] Đặt `entryCost > 0` cho giveaway tới — sink thật, 0 dòng code
- [ ] Mở rộng catalog `shop-manager`: role danh hiệu, XP boost, slot showcase ưu tiên
- [ ] `/shop history` — đọc `ShopPurchase` đang ghi mà không đọc
- [ ] Bán plugin/docs: dùng `ShopPurchase` làm sổ đơn + mô hình `GiveawayRewardDelivery` để giao. **Không giới hạn số lượng** (hàng số). Niêm yết giá công khai, ghi rõ **không hoàn xu sau khi giao**
- [ ] **Đặt giá plugin/docs đủ cao** — không giới hạn số lượng nên giá là đòn điều tiết duy nhất; tham chiếu: `/star` upgrade tốn `180 + lvl²×120`, tool 250-1400
- [ ] ~~Chống alt / mức tối thiểu~~ — **user quyết bỏ**; hợp lý vì không có chợ (alt không chuyển được xu) + giao thủ công (owner thấy mặt người mua)
- [ ] ~~Chợ / đấu giá giữa người chơi~~ — **bỏ khỏi scope** (không phải sink, làm lạm phát tệ hơn)

**Đợt 4 — Sự kiện AI (plan riêng)**
- [ ] 1 sự kiện/tuần, owner bấm mở, 3-4 lượt vote cả server
- [ ] Thưởng **lấy từ tiền vé của chính sự kiện đó**, KHÔNG in xu mới (tránh thành faucet thứ 9)

## Success metrics

| Tiêu chí | Mục tiêu |
|---|---|
| Câu hỏi kèm ảnh Stella trả lời đúng nội dung ảnh | ≥ 8/10 lần thử tay |
| Ảnh ngoài Discord CDN | 100% bỏ qua, 0 lỗi runtime |
| Spam ảnh liên tiếp | cooldown chặn, 0 lần vượt hạn mức/ngày |
| Mục "GỢI Ý KẾT NỐI" xuất hiện trong báo | 7/7 ngày tuần đầu |
| Người bị nêu tên có đường opt-out | 100% — có lệnh, có xác nhận |
| Có người hưởng ứng gợi ý kết nối | ≥ 1 lượt / 2 tuần → mới xét nâng lên ping trực tiếp |
| Kênh tính `expertScore` khớp cấu trúc hiện tại | xác nhận xong, điểm tăng được khi vote thử |
| Model/config chết trong repo | 0 (`TriviaWin`, `config.digest`) |
| Showcase thắng / job xong lên nhật báo | 100% tuần đầu sau khi nối |
| **Tổng cung scoin sau 1 tháng có sink mới** | không tăng nhanh hơn tháng trước (đo `scoinEarnedTotal` vs tổng chi) |
| Tranh cãi về đơn hàng plugin/docs | 0 — nhờ giá + chính sách không hoàn niêm yết trước |
| Xu tiêu vào hàng thật mỗi tháng | > 0 và tăng — nếu bằng 0 thì giá quá cao, cần hạ |
| `npm run build` + self-check | pass, không giảm số assertion |

## Trạng thái: SCOPE ĐÃ CHỐT — sẵn sàng chuyển `ak:plan`

Không còn câu hỏi treo. Hạng mục khởi động được ngay, không phụ thuộc gì:
1. **Vé giveaway** — `entryCost > 0`, 0 dòng code, có sink hôm nay
2. **Vision chat** — hạng mục code rẻ nhất, hạ tầng đã sẵn


