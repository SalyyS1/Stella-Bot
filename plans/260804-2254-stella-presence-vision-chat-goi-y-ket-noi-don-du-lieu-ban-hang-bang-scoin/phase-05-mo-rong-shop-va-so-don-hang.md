---
phase: 5
title: "Mo rong shop va so don hang"
status: pending
priority: P2
effort: "4h"
dependencies: [4]
---

# Phase 5: Mo rong shop va so don hang

## SUA LAI SAU RED-TEAM — `buyColorRole` KHONG phai mau dung

Ban dau plan nay ghi "copy y nguyen `buyColorRole`, no da xu ly atomicity dung". **SAI.** Da verify `shop-manager.ts:88-140`:

`buyColorRole` la **4 transaction roi rac**, khong co lock, khong co transaction bao ngoai:
1. `adjustScoin(-price)` — `scoinManager.ts:39` tu mo `$transaction` rieng roi **commit**
2. `member.roles.remove(...)` — goi Discord API
3. `member.roles.add(...)` — goi Discord API; loi thi `adjustScoin(+price)` (transaction thu 3)
4. `prisma.shopPurchase.create(...)` — transaction thu 4

**Hai lo hong that:**

- **Mat xu khong dau vet**: bot restart / DB drop / Discord treo giua buoc 1 va buoc 4 → nguoi dung **bi tru xu, khong co mon, khong co refund, khong co dong `ShopPurchase` nao** → owner khong the biet don do tung ton tai. Voi role mau la kho chiu; voi plugin 1500 xu la mat tien khong bang chung.
- **TOCTOU double-spend**: check so huu (`:83`) va tru xu (`:91`) khong duoc serialize. Double-click → ca 2 request qua check, ca 2 tru xu thanh cong (so du 400 >= 200 hai lan), `roles.add` idempotent → **tra 400 cho 1 role**. Chinh la success criteria "2 lan mua dong thoi tru dung 1 lan" ma plan nay tu dat ra, va mau `buyColorRole` KHONG dat duoc.

**Mau DUNG co san trong repo: `src/commands/star.ts:355-378`**

```
await prisma.$transaction(async tx => {
    await lockStarUser(tx, userId);        // :109 — row lock bang increment 0
    const owned = await tx.starTool.findUnique(...);  // check TRONG transaction
    if (owned) throw new StarGameError(...);
    await debitScoinIfEnough(tx, userId, price, ...); // :115 — conditional updateMany + throw
    await tx.starTool.create(...);         // giao mon TRONG cung transaction
});
```

→ Phase nay **theo mau `star.ts`**, khong theo `buyColorRole`. Tat ca: lock → check so huu → tru xu → ghi mon → ghi don, trong MOT `$transaction`.

## Overview

Shop hien CHI co role mau (200 scoin) — day la ly do xu u dong. Them mon hang moi + doc `ShopPurchase` (dang ghi ma khong doc). Nen mong cho Phase 6.

## Requirements

- Functional: shop co them mon ngoai role mau (role danh hieu, XP boost)
- Functional: `/shop history` doc `ShopPurchase` da ghi
- Non-functional: tru xu **atomic** — row lock + tat ca trong MOT `$transaction`, theo mau `star.ts:355-378` (KHONG theo `buyColorRole`, xem muc dau file)
- Non-functional: mua that bai (role loi, het hang) → hoan xu

## Architecture

Theo mau `star.ts:355-378` (xem muc "SUA LAI SAU RED-TEAM" o dau file). Mot `$transaction` bao tat ca:

1. `lockStarUser(tx, userId)` tuong duong — row lock bang `increment: 0`
2. Check da so huu chua — **trong** transaction
3. `debitScoinIfEnough(tx, ...)` — conditional `updateMany` voi `gte`, throw khi thieu
4. Ghi mon (role / buff row)
5. Ghi `ShopPurchase`

Cap role Discord la **side effect ngoai DB** → khong the nam trong transaction. Xu ly: ghi don trang thai `PENDING` trong transaction, cap role sau, roi transaction thu 2 danh dau `DELIVERED`. Neu cap role that bai → transaction hoan xu + danh dau `REFUNDED`.

`ShopPurchase` (`schema.prisma:402`) hien **khong co truong trang thai** → can them (xem Phase 6, cung dung). Them luon o phase nay vi ca hai deu can.

**Backup/restore lo hong** (red-team tim ra): `scripts/db-utils.js` liet ke 20 bang de backup, **`ShopPurchase` KHONG co trong danh sach**. `restore-db.js:33-37` `clearExistingData` xoa `User` → cascade (`schema.prisma:409`) xoa sach `ShopPurchase`, roi restore chi phuc hoi 20 bang duoc liet ke → **toan bo so don hang bien mat**. Phai them `ShopPurchase` vao `db-utils.js` o phase nay, TRUOC khi Phase 6 ban hang that.

## Related Code Files

- Modify: `src/config.ts` — them catalog mon moi (key, label, price, loai)
- Modify: `prisma/schema.prisma` + migration — them `status` (`PENDING|DELIVERED|REFUNDED`) + `deliveredAt` vao `ShopPurchase`; them `@@unique([userId, itemKey])` cho hang so (Phase 6 can)
- Modify: `src/systems/shop-manager.ts` — ham mua theo mau `star.ts` (lock + 1 transaction); ham doc lich su
- Modify: `src/commands/shop.ts` — subcommand mua mon moi + `history` (**self-only, ephemeral**)
- Modify: `scripts/db-utils.js` — them `ShopPurchase` vao danh sach bang backup (dang thieu → restore xoa sach so don)
- Modify: `scripts/self-check.js` — assert cau truc: `shopPurchase.create` nam TRONG `$transaction`, lock truoc debit

## Implementation Steps

1. Migration: them `status` + `deliveredAt` vao `ShopPurchase`, va `@@unique([userId, itemKey])` (chan mua trung hang so — Phase 6 dung).
2. Them `ShopPurchase` vao `scripts/db-utils.js` danh sach bang + vao vong lap model cua `scripts/self-check.js`. **Lam truoc khi co don that.**
3. Dinh nghia catalog mon moi trong config: role danh hieu, XP boost.
4. Ham mua theo mau `star.ts:355-378`: `$transaction` bao `lock → check so huu → debitScoinIfEnough → ghi mon → ghi don PENDING`. Cap role sau transaction; thanh cong → transaction 2 danh dau `DELIVERED`; that bai → transaction hoan xu + `REFUNDED`.
5. **Refund khong duoc tang `scoinEarnedTotal`** (`scoinManager.ts:136` dang tang khi amount duong) — leaderboard `/scoin top` xep theo truong nay, hoan tien khong phai "kiem duoc". Dung duong tx rieng hoac co bo qua.
6. XP boost: kiem tra tai dung `StarBuff` truoc khi tao model moi. Neu dung, **prefix namespace cho `key`** de buff shop khong hien trong UI `/star` (`star.ts:318` fallback ve raw key khi `BUFF_SHOP` khong khop).
7. `listPurchaseHistory(userId)`: doc `ShopPurchase` theo `userId`, moi nhat truoc, cap 10-20 dong.
8. `/shop history`: **khong co option `user`** (hoac chi admin), **luon `MessageFlags.Ephemeral`**, chi hien itemKey/label/gia/ngay — khong bao gio hien link. Lan can `/scoin history` (`scoin.ts:102`) cho phep xem cua nguoi khac va khong ephemeral — **khong copy mau do**.
9. `/shop` hien catalog: nhom theo loai, hien gia + so huu chua.
10. Self-check assert **cau truc, khong phai substring**: index cua `shopPurchase.create` nam trong pham vi callback `$transaction`; `lock` xuat hien truoc `debit` (theo mau assert thu tu da co o `self-check.js:69`).
11. `npm run build` + self-check + test tay: mua du xu, mua thieu xu, mua trung mon, **double-click mua**.

## Todo

- [ ] Migration: `ShopPurchase.status` + `deliveredAt` + `@@unique([userId, itemKey])`
- [ ] Them `ShopPurchase` vao `db-utils.js` + self-check model loop (**truoc khi co don that**)
- [ ] Catalog mon moi trong config
- [ ] Ham mua theo mau `star.ts`: lock + 1 transaction (KHONG theo `buyColorRole`)
- [ ] Refund khong tang `scoinEarnedTotal`
- [ ] XP boost: tai dung `StarBuff` + prefix key de khong hien trong `/star`
- [ ] `listPurchaseHistory` + `/shop history` (self-only, ephemeral, khong hien link)
- [ ] `/shop` hien catalog nhom theo loai
- [ ] Self-check assert cau truc (create trong transaction, lock truoc debit)
- [ ] `npm run build` + test tay 4 tinh huong (co double-click)

## Success Criteria

- [ ] Mua mon moi khi du xu → tru dung gia, nhan duoc mon, don ghi `ShopPurchase` voi `status`
- [ ] Mua khi thieu xu → tu choi, **khong tru dong nao**
- [ ] Mua trung mon da so huu → tu choi (chan boi unique constraint + check trong transaction)
- [ ] **Double-click mua → tru dung 1 lan** (day la tieu chi mau `buyColorRole` khong dat duoc)
- [ ] Cap mon that bai → xu duoc hoan, don `REFUNDED`
- [ ] Refund → `scoinEarnedTotal` khong tang
- [ ] `npm run db:backup` roi `db:restore --replace` → **so don van con** (truoc khi sua se mat sach)
- [ ] `/shop history` chi xem duoc cua chinh minh, ephemeral
- [ ] XP boost mua o shop → khong hien trong UI `/star`
- [ ] `npm run build` + self-check pass

## Risk Assessment

| Rui ro | Muc | Giam thieu |
|--------|-----|-----------|
| **Mat xu khong dau vet** (restart giua tru xu va ghi don) | Cao | 1 transaction bao lock+debit+ghi don (mau `star.ts`); don `PENDING` co dau vet |
| **Double-spend khi double-click** | Cao | Row lock + check trong transaction + unique constraint |
| **Restore backup xoa sach so don** | Cao | Them `ShopPurchase` vao `db-utils.js` o buoc 2 |
| `/shop history` lo don cua nguoi khac | Trung | Self-only + ephemeral (buoc 8); khong copy mau `/scoin history` |
| Refund lam phinh `scoinEarnedTotal` → sai leaderboard | Trung | Buoc 5 |
| XP boost hien trong UI `/star` | Thap | Prefix namespace key (buoc 6) |
| XP boost la faucet gian tiep (XP nhanh → level → xu) | Thap | Dat gia du cao de net van la sink |
