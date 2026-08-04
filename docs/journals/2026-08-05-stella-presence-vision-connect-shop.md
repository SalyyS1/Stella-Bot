---
date: 2026-08-05
branch: main
commits: f90aff9..2d5865e
---

# Stella từ bot trả lời thành thành viên có mặt

## Bối cảnh

Bot đã lớn: 34 model Prisma, 9 hệ thống cộng đồng, nhật báo AI map-reduce chạy ổn. Nhưng Stella bị động — chỉ nói khi bị gọi, không thấy ảnh dù gateway hỗ trợ vision, và `MemberFact` tích được 35 dòng chỉ để nhồi vào prompt Q&A. Phiên này làm 6 phase: vision chat, gợi ý kết nối, dọn dữ liệu chết, mở rộng shop, bán hàng số.

## Ba lần tôi kết luận sai, và cách phát hiện

**1. "`expertScore` không có writer."** Scout vòng 1 grep hẹp trong `requestManager` rồi kết luận trường này chết, hiện số 0 vĩnh viễn cho mọi người. Sai — `voteManager.ts:107` tăng nó khi bài trong kênh showcase được vote up. Query DB thật: **24 người đang có điểm**, 486 vote, vote gần nhất là hôm nay. Việc "sửa `expertScore`" bị bỏ khỏi Phase 4 hoàn toàn.

**2. "Copy y nguyên `buyColorRole`, nó xử lý atomicity đúng."** Đây là câu tôi tự viết vào plan. Red-team bắt đọc lại code: hàm đó là **4 transaction rời rạc**, không lock. Hai lỗ thật — double-click trừ tiền 2 lần, và bot chết giữa lúc trừ xu với lúc ghi đơn thì người dùng mất xu không dấu vết. Mẫu đúng nằm sẵn trong repo (`star.ts:355-378`: row lock + một transaction). Đã đo: 2 lần mua đồng thời chỉ trừ 1 lần.

**3. "Showcase thắng không lên báo."** Cả scout và red-team đều nói vậy. Đọc `report-context-sources.ts:10` thì `gatherServiceBoard` **đã** đọc `ShowcasePost` và `RequestPost` từ trước. Phạm vi Phase 4 đổi từ "nối vào báo" thành "bổ sung tín hiệu còn thiếu" — cụ thể là job DONE trong 24h, thứ khiến trước đây không ai được nhắc khi làm xong việc.

Bài học chung: grep hẹp và suy luận từ tên hàm đều ra kết luận sai. Ba lần này chỉ lộ ra khi query DB thật hoặc đọc hết thân hàm.

## Lỗ nghiêm trọng nhất: hoàn xu thành đường lấy hàng miễn phí

Plan ban đầu ghi "DM lỗi thì hoàn xu **hoặc** cho `/shop redeem`". Hai đường cùng tồn tại thì: tắt DM → mua → trừ 1500 → DM lỗi → hoàn 1500 → đơn vẫn còn → bật DM → redeem → có plugin. Trả 0 xu, lặp được với mọi món.

Sửa bằng trạng thái trong DB, không bằng comment: `ShopPurchase.status` (`PENDING|DELIVERED|REFUNDED`), redeem chỉ nhận `DELIVERED`, và việc hoàn xu đánh dấu `REFUNDED` trong cùng transaction với lúc cộng xu. Đã diễn lại đúng kịch bản tấn công: redeem sau khi hoàn xu bị chặn.

## Ảnh suýt thành dữ liệu lưu trữ

`extractFact` chạy vô điều kiện ở `aiQaManager.ts:216`. Phase 2 làm câu trả lời thành mô tả nội dung ảnh — nên mô tả sẽ thành `MemberFact` bền vững, rồi Phase 3 đăng nó lên báo công khai. Đúng thứ mà dòng comment ở `config.ts:414` hứa loại trừ: *"Ảnh không bao giờ được lưu."*

Ai chụp thời khoá biểu hỏi Stella thì tối đó lên mục kết nối. Đã chặn và verify bằng DB: hỏi kèm ảnh → 0 fact mới.

## Quyết định đổi giữa đường: bỏ nêu tên

User chốt "nêu tên thật" cho mục gợi ý kết nối. Red-team chỉ ra server Minecraft VN nhiều trẻ vị thành niên, và hệ thống **không có tín hiệu tuổi nào** (`Birthday` chỉ lưu ngày/tháng, không có năm) — bot ghép đôi có thể ghép em 13 tuổi với người lạ, và chính sự bảo đảm của một con bot được tin tưởng là vector gây hại.

Trình bày trade-off, user đổi sang **nhóm không nêu tên**. Quyết định này xoá 5 rủi ro bằng thiết kế: trẻ vị thành niên bị ghép đôi, đồng thuận cá nhân, người đã rời server bị nêu tên, AI bịa userId, N+1 fetch display name. Và Phase 3 không còn cần migration hay lệnh opt-out.

Kết quả thật trên bản tin: *"OpenAI API và mô hình AI — 6 người cùng quan tâm"*. Người đọc vẫn tìm được nhau; bot không đứng ra giới thiệu ai với ai.

## Backup thiếu 6 bảng — restore một lần là mất hẳn

`scripts/db-utils.js` liệt kê 20 bảng. `ShopPurchase`, `MemberFact`, `WeeklyActivity`, `DailyQuest`, `Birthday`, `ShopColorRole` đều không có. Điều này tệ hơn "không được backup": `restore-db.js` xoá `User` trước, cascade quét sạch chúng, rồi restore chỉ dựng lại 20 bảng trong danh sách. **915 dòng dữ liệu thật** (35 fact + 106 tuần hoạt động + 774 quest) sẽ mất vĩnh viễn sau một lần restore, và sổ đơn hàng sẽ trống trong khi người mua đã trả tiền.

## Link tải: ba đường rò rỉ, không phải một

Plan ghi "log chỉ ghi itemKey" — cách kiểm tra đó sai từ tiền đề. Không có call site nào in link; **error object mới là thứ in nó**. `DiscordAPIError` mang `requestBody.json` = cả payload, nên `console.error(error)` ở `interactionCreate.ts:154` in nguyên link ra stdout, và dòng `:161` còn gửi stack vào kênh botLog Discord.

Ba đường đã bịt: ném lại `DmFailedError` chỉ mang mã lỗi; link đọc từ env (config đi vào git); và `report-chunk-collector` ẩn link trước khi lưu transcript — vì kênh chat nằm trong `report.sourceChannels`, nên người mua dán "tải được rồi: link" vào chat là bot tự phát link cho cả server, in luôn vào ảnh báo PNG không redact lại được.

Đã đo cả ba: link không lọt vào log dù tầng trên in cả error và stack.

## Kết quả

- 6/6 phase, 112 task, build sạch, self-check 77 → **102 assertions**
- Vision chat: Stella mô tả đúng ảnh Discord CDN ("Logo Discord")
- XP boost đo được có tác dụng thật: 43 → 86 XP
- 2 migration áp lên DB production, `TriviaWin` (0 row) đã drop
- Mọi tiêu chí đều verify bằng chạy thật, không bằng đọc code

## Còn lại

- Owner cần đặt `SHOP_LINK_*` trong `.env` — món chưa có link thì không bán được (fail-closed)
- Mục "GỢI Ý KẾT NỐI" nên được thông báo trước cho thành viên trước khi bản tin 21h đầu tiên chạy
- 2 vulnerability npm (1 moderate, 1 high) chưa xử lý, ngoài phạm vi phiên này
- Nên theo dõi "xu tiêu vào hàng thật/tháng": bằng 0 nghĩa là giá quá cao
