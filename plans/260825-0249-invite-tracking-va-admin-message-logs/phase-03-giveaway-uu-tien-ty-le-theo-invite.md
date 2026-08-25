# Phase 03 — Giveaway Ưu Tiên Tỷ Lệ Theo Invite

Trạng thái: DONE (`tests/giveaway-weighted-draw.test.ts` — 6 test pass, 20k lượt quay kiểm tỷ lệ)
Phụ thuộc: P1

> Ghi chú khi cook: thuật toán quay được tách sang `src/systems/invite/weighted-draw.ts`
> vì `invite-giveaway-weight.ts` import Prisma, mà một test quay 20 nghìn lượt trong bộ
> nhớ thì không nên cần database. Self-check cũ chốt "nguồn ngẫu nhiên an toàn" theo
> `giveawayManager.ts` đã được trỏ sang file mới — invariant giữ nguyên, chỉ đổi chỗ kiểm.

## Bối Cảnh

- `src/systems/giveawayManager.ts:297` — `pickWinners()` hiện quay **đều tay**: dedupe rồi `randomInt(pool.length)`.
- `prisma/schema.prisma:289` — `GiveawayEntry.entries Int @default(1)` **đã tồn tại nhưng chưa ai dùng** (grep chỉ ra `include: { entries: true }` là quan hệ, không phải cột này). Đây đúng là chỗ để số vé.
- `src/systems/giveawayManager.ts:397` — entries chỉ được đọc SAU khi claim chuyển trạng thái `ENDING`, nên tính lại số vé ở đó là an toàn với join/leave đang chạy.
- `src/commands/giveaway.ts:33` — modal tạo nhanh đã dùng đủ 5 hàng (Discord tối đa 5) → option invite **chỉ** thêm vào `/giveaway create`, không nhét vào modal.

## Yêu Cầu

1. Nhiều invite = nhiều vé, **không** phải trúng luôn.
2. Hai chế độ đếm: `all_time` (tổng từ trước tới giờ, gồm `legacyUses`) và `since_start` (chỉ lượt verified sau lúc tạo giveaway).
3. Người tham gia xem được tỷ lệ của mình.
4. Giveaway không bật invite → hành vi y như cũ.

## Schema

```prisma
model Giveaway {
  // ... giữ nguyên các cột cũ
  inviteBonusMode String    @default("none") // none | all_time | since_start
  inviteWeightPer Int       @default(1)      // +N vé mỗi lượt mời verified
  inviteWeightCap Int       @default(10)     // trần vé CỘNG THÊM, chống 1 người ăn cả
  inviteCountFrom DateTime?                  // mốc đếm cho since_start (= lúc tạo)
}
```

Migration `20260825010000_giveaway_invite_weight/migration.sql`: `ALTER TABLE "Giveaway" ADD COLUMN IF NOT EXISTS ...` với default — giveaway đang chạy tự động về `none`, không đổi hành vi.

## Công Thức

```
vé = 1 + min(inviteWeightCap, soLuotMoi * inviteWeightPer)
tỷ lệ hiển thị = vé / tổng vé của mọi người đủ điều kiện
```

Mặc định `per=1, cap=10`: mời 0 → 1 vé; mời 3 → 4 vé; mời 30 → 11 vé (trần). Người không mời ai **vẫn luôn có 1 vé** — đúng tinh thần "ưu tiên chứ không phải trúng luôn".

`all_time` dùng `legacyUses + verifiedCount`; `since_start` dùng `count(InviteJoin where inviterId AND status='VERIFIED' AND verifiedAt >= inviteCountFrom)`.

> Lưu ý về `since_start`: mốc so sánh là `verifiedAt`, không phải `joinedAt`. Người mời trước giveaway 20h rồi verify trong giveaway vẫn được tính — chấp nhận, vì dùng `joinedAt` thì người mời vào giờ cuối lại **mất** vé do cổng 24h chưa xong. Không có mốc nào đúng cả hai chiều; chọn cái không phạt người mời thật.

## Module

| File | Trách nhiệm |
|---|---|
| `src/systems/invite/invite-giveaway-weight.ts` | `computeEntryWeight(giveaway, userId)`, `computeWeightTable(giveaway, userIds)` |

Không nhồi vào `giveawayManager.ts` (đang 539 LOC — vượt ngưỡng 200 rồi).

## Các Bước

1. Schema + migration + `prisma generate`.
2. **`computeEntryWeight`** như công thức trên; `inviteBonusMode === 'none'` → trả `1` (không truy vấn DB).
3. **`joinGiveaway`** (`giveawayManager.ts:262`): tạo entry với `entries: await computeEntryWeight(...)` để hiện tỷ lệ ngay lúc join.
4. **`endGiveaway`** (`:406`): trong vòng lặp lọc `validEntries`, **tính lại** vé (số vé lúc quay mới là số có hiệu lực — người mời thêm sau khi join vẫn được cộng). Dựng `weighted: { userId, weight }[]`.
5. **`pickWinners`** → `pickWinnersWeighted(weighted, count)`: cộng dồn trọng số, `randomInt(total)` chọn theo khoảng, loại người đã trúng rồi quay tiếp (không hoàn lại). Giữ `randomInt` của `crypto` như hiện tại. `weight <= 0` → coi là 1 (không ai bị loại vì lỗi tính).
6. **Embed** (`buildGiveawayEmbed`): nếu bật invite, thêm field `Ưu tiên theo lượt mời`: mô tả chế độ + `+N vé/lượt (trần +M)`.
7. **Nút mới** `giveaway_odds_<id>` trong `giveawayButtons()`: ephemeral trả "Bạn có **X** vé / tổng **Y** vé ≈ **Z%** · số lượt mời được tính: **N**". Chưa tham gia thì báo số vé sẽ có nếu tham gia.
8. **`interactionCreate.ts`**: route `giveaway_odds_` cạnh các nhánh `giveaway_*` sẵn có.
9. **`/giveaway create`** thêm 3 option: `invite_bonus` (choices: Không / Tổng từ trước tới giờ / Tính từ lúc tạo), `invite_weight` (1-10, default 1), `invite_cap` (0-50, default 10). `since_start` → set `inviteCountFrom = now()`.
10. **`/giveaway participants`**: khi bật invite, hiện thêm `(N vé)` sau mỗi tên, sắp theo vé giảm dần — bảng xếp hạng mini ngay trong giveaway.

## Kiểm Chứng

- `npm run build` pass; self-check assertion: `giveawayManager.ts` chứa `pickWinnersWeighted`, không còn `pickWinners(` cũ ở nhánh end.
- Unit test mới `tests/giveaway-weighted-draw.test.ts` (theo mẫu `tests/money-flow-concurrency.test.ts`): 10k lượt quay với weight `[1, 9]` → người weight 9 thắng trong khoảng 88-92%; weight rỗng → trả `[]`; `count > số người` → trả hết người, không lặp trùng.
- Thử tay: tạo giveaway `since_start`, ép 2 dòng InviteJoin VERIFIED cho acc thử → nút "Tỷ lệ của tôi" hiện 3 vé.
- Giveaway `none` → số vé mọi người = 1, kết quả phân bố đều như cũ.

## Rủi Ro

| Rủi ro | Xử lý |
|---|---|
| Người mời nhiều gần như chắc thắng → người mới bỏ chơi | `inviteWeightCap` mặc định 10; embed nói rõ "ưu tiên, không phải chắc trúng"; nút tỷ lệ cho thấy con số thật |
| Farm invite để ăn giveaway | Cổng verify của P1 (pick role + 7 ngày + 24h) là lá chắn chính; `since_start` càng ngắn càng khó farm |
| Đổi cột `entries` làm lệch giveaway đang chạy | Default `none` + tính lại lúc quay; giveaway cũ giữ `entries=1` |
| `entries` cũ lỡ mang nghĩa khác | Đã grep: cột này chưa từng được đọc/ghi ở đâu, an toàn để dùng |
