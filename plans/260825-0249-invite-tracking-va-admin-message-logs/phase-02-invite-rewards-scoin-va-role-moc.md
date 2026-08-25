# Phase 02 — Invite Reward: 50 Scoin Mỗi Lượt Verified

Trạng thái: DONE
Phụ thuộc: P1

## Chốt Của Saly (2026-08-25)

| Hạng mục | Chốt |
|---|---|
| Scoin mỗi lượt verified | **50**, **không giới hạn ngày** |
| Role mốc 5/10/25/50/100 | **Bỏ** — "tạo lắm role rối Discord" |
| Chúc mừng công khai khi đạt mốc | **Không có** |

Kết quả: phase này gọn lại còn một việc — trả xu đúng một lần cho mỗi lượt mời thật.

## Đã Làm

`src/systems/invite/invite-rewards.ts` — `awardInviteReward(client, inviterId, invitedId, source)`:

1. Trả `config.invites.scoinPerInvite` (50) qua `adjustScoinTx` với `source='invite:verified'`, `metadata='invite:<invitedId>'`.
2. DM riêng cho người mời: ai mời được ai, +bao nhiêu xu, tổng bao nhiêu lượt.
3. Không tạo role, không đăng gì ra kênh chat.

`/invites show` hiện thêm dòng **Scoin từ mời** — tổng `ScoinTransaction` có `source='invite:verified'`.

## Hai Quyết Định Trong Lúc Cook

**1. Không cần bảng mới.** Chốt chống trả xu hai lần là `InviteJoin.status`: `invite-verification.ts` chỉ gọi `awardInviteReward` khi câu `updateMany` đổi `PENDING → VERIFIED` trả về đúng 1 dòng. Bot chết giữa hai bước thì lần quét sau không vào lại nhánh đó. Lịch sử trả xu đã nằm ở `ScoinTransaction` với metadata truy được về từng lượt mời, nên một bảng riêng chỉ là bản sao kém hơn.

**2. Lượt `VANITY`/`UNKNOWN` không sinh Scoin.** Vẫn được ghi công cho Saly theo chốt "link mặc định thì quy hết về tôi", nhưng không trả xu: không ai thực sự mời những người đó, nên trả xu cho nó là in tiền theo lượng người vào server. `/invites show` hiện số này ở một mục riêng nói rõ "không sinh Scoin". Muốn đổi thì bỏ điều kiện `source === 'INVITE'` trong `invite-rewards.ts`.

## Đã Kiểm

- `npm run build` pass, `npm test` pass (131 assertion).
- Self-check chốt cứng: `invite-rewards.ts` phải có `source === 'INVITE'` và `'invite:verified'`; `invite-verification.ts` phải có `claimed.count !== 1` (cổng idempotent).
- Còn phải thử tay trên server thật: ép một lượt sang VERIFIED, kiểm `ScoinTransaction` chỉ có 1 dòng, chạy sweep lần hai không sinh dòng thứ hai.

## Rủi Ro Còn Lại

| Rủi ro | Trạng thái |
|---|---|
| Trả xu hai lần khi restart giữa sweep | Đã chặn bằng flip trạng thái có điều kiện |
| Lạm phát Scoin khi ai đó mời rất nhiều | **Còn mở** — Saly chốt không cap. Cổng verify (7 ngày + 24h + pick role) là lá chắn duy nhất |
| Người mời chặn DM | Vẫn tính lượt, vẫn cộng xu; chỉ mất thông báo |
