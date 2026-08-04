---
phase: 6
title: "Ban plugin docs bang scoin"
status: pending
priority: P2
effort: "4h"
dependencies: [5]
---

# Phase 6: Ban plugin/docs bang scoin

## CHAN TREN (red-team findings, BAT BUOC)

**1. Hoan xu + redeem = plugin mien phi.** Ban dau plan ghi "DM loi thi hoan xu **hoac** cho `/shop redeem`" — hai duong nay cung ton tai thi:
   - User tat DM → mua → tru 1500 → ghi don → DM throw → hoan 1500 → **don van con** → bat DM lai → `/shop redeem` → nhan link. Net: **tra 0 xu, co plugin**. Lap lai duoc voi moi mon.
   → Sua: `ShopPurchase.status` (`PENDING|DELIVERED|REFUNDED`) tu Phase 5. `/shop redeem` chi chap nhan `status = DELIVERED`. Duong hoan xu set `REFUNDED` **trong cung transaction voi viec cong xu**. "Chon 1 huong, ghi ro trong comment" khong phai co che — trang thai trong DB moi la co che.

**2. Log in link qua `console.error(error)`.** Plan ghi "log chi ghi itemKey" nhung kiem tra grep khong bat duoc lo hong that: `interactionCreate.ts:154` goi `console.error(error)`. Khi `user.send({ content: '...<link>...' })` that bai, discord.js throw `DiscordAPIError` **mang theo `requestBody.json`** = payload chua link. `util.inspect` in ca thuoc tinh enumerable → **link vao stdout/log host**. Nang hon: `interactionCreate.ts:161` gui `String(error?.stack).slice(0,1000)` **vao kenh botLog Discord**.
   → Sua: boc `user.send` trong try rieng, catch va **throw lai error da lam sach** (chi ma loi, khong mang object goc). Tuyet doi khong noi link vao message cua bat ky `Error` nao.

**3. Nhat bao co the dang lai link ra forum cong khai.** `config.ts:326-333` `report.sourceChannels` gom `channels.chat`. `report-chunk-collector.ts:84-91` giu 700 ky tu/tin nhan nguyen van → luu `ReportChunk` → composer → `report-publisher.ts:40` dang ra forum **cong khai**, va gio con in vao anh bao PNG (khong the xoa/redact sau).
   Kich ban: nguoi mua dan "cam on, tai duoc roi: https://drive.../xyz" vao kenh chat → 21h ban tin dang link do ra forum cho ca server.
   → Sua: loc/redact URL cua host giao hang ngay tu buoc collect chunk + dan trong prompt composer. Hoac dung link co the thu hoi / token theo tung don.

**4. `ShopPurchase` khong nam trong backup** (`scripts/db-utils.js` liet ke 20 bang, thieu no) + `restore-db.js` xoa `User` → cascade xoa sach don. Restore mot lan → **moi don hang bien mat**, `/shop redeem` tu choi moi nguoi da tra tien, va khong con bang chung ai da tra. Sua o Phase 5 (da them vao Todo phase do), Phase 6 phu thuoc.

## Overview

Ban san pham that cua owner (plugin tu dev, docs) bang scoin. Bot tu DM link tai ngay sau khi mua. Day la sink manh nhat vi hang co gia tri that ngoai game.

## Requirements

- Functional: mua plugin/docs bang scoin → tru xu → bot DM link tai ngay
- Functional: gia **plugin 1000-1500, docs 300-500** (user da chot)
- Functional: **khong gioi han so luong** (hang so, copy vo han)
- Functional: don ghi vao `ShopPurchase` (dung so don Phase 5)
- Non-functional: DM that bai (user tat DM) → **hoan xu** hoac cho lay lai link
- Non-functional: link KHONG duoc lo trong log / kenh cong khai

## Architecture

**Canh bao kinh te da ghi trong advise report**: khi xu mua duoc hang co gia tri that ngoai Discord, xu ngung la diem vui va thanh **tien**. User da chot **khong** dat muc toi thieu chong alt — hop ly vi:

- **Khong co cho** (da bo khoi scope) → alt khong chuyen duoc xu cho nick chinh
- Alt tu tich xu thi cung chi alt do co plugin — vo nghia

→ **Khong xay cong chan alt trong phase nay.** Nhung ghi lai: neu sau nay mo cho hoac tu dong hoa gi khac, rui ro alt quay lai.

**Giao hang (user chot: bot tu DM link ngay)**:

Luong 2 pha + trang thai (giao hang la side effect NGOAI DB, khong the nam trong transaction):

```
tx1: lock -> check unique -> debit -> ghi don PENDING     (mau star.ts:355-378, xem Phase 5)
DM link
tx2 thanh cong: don -> DELIVERED + deliveredAt
tx2 DM loi:     hoan xu + don -> REFUNDED   [CUNG 1 transaction]
```

`/shop redeem` chi tra link khi `status = DELIVERED` → don `REFUNDED` khong redeem duoc (chan lo hong #1). Don `PENDING` treo (bot chet giua 2 pha) can **sweeper luc khoi dong**: don `PENDING` qua han → thu DM lai hoac hoan xu. Khong co sweeper thi nguoi dung mat xu vinh vien.

**Link luu o dau**: env (khong commit) neu link private. Kiem tra `.gitignore` truoc.

**Chinh sach phai ghi ro tren mon hang** (tranh tranh cai):
- Gia niem yet cong khai
- **Khong hoan xu sau khi da giao link**
- Link co the bi chia se lai — user da chap nhan trade-off nay

## Related Code Files

- Modify: `src/config.ts` (hoac env) — catalog plugin/docs: key, label, gia, link tai, mo ta
- Modify: `src/systems/shop-manager.ts` — ham mua hang so 2 pha + sweeper don PENDING
- Modify: `src/commands/shop.ts` — subcommand mua hang so; `/shop redeem` (chi `DELIVERED`)
- Modify: `src/events/interactionCreate.ts` — **khong de `console.error(error)` in payload chua link** (dong 154) va khong gui stack vao kenh botLog (dong 161) cho duong mua
- Modify: `src/systems/report/report-chunk-collector.ts` — redact URL host giao hang truoc khi luu chunk (chan nhat bao dang lai link)
- Modify: `scripts/self-check.js` — assert khong log link + redeem chi `DELIVERED` + sweeper ton tai
- Modify: `.gitignore` neu link phai nam ngoai git

## Implementation Steps

1. Quyet cho luu link: link private → **env**, khong commit. Kiem tra `.gitignore`.
2. Catalog hang so trong config: key, label, loai, gia (plugin 1000-1500, docs 300-500), mo ta + **dong chinh sach khong hoan xu sau khi giao**.
3. Ham mua 2 pha theo so do o tren (dung `ShopPurchase.status` da them o Phase 5). Mua trung hang so → bi chan boi `@@unique([userId, itemKey])`, huong nguoi dung sang `/shop redeem` mien phi.
4. DM link: boc `user.send` trong try **rieng**. Catch → **throw lai error da lam sach** (chi ma loi, khong mang object goc, khong noi link vao message). Roi tx2 hoan xu + `REFUNDED`.
5. Sweeper luc khoi dong: quet don `PENDING` qua han → thu DM lai; that bai → hoan xu + `REFUNDED`.
6. `/shop redeem`: chi tra link cho don `status = DELIVERED` cua chinh nguoi goi. Ephemeral. Chan nguoi chua mua va don `REFUNDED`.
7. **Chan link ra log**: rà `interactionCreate.ts:154` (`console.error(error)`) va `:161` (stack vao botLog) — duong mua hang khong duoc di qua 2 cho nay voi error goc.
8. **Chan link ra nhat bao**: redact URL cua host giao hang trong `report-chunk-collector` truoc khi luu chunk. Neu khong lam duoc, phai dung link thu hoi duoc/token theo don va ghi ro han che.
9. Hien mon hang so trong `/shop` kem gia + dong chinh sach.
10. Self-check assert: (a) redeem loc `DELIVERED`, (b) duong mua khong log error goc, (c) sweeper ton tai, (d) refund + set `REFUNDED` cung transaction.
11. `npm run build` + self-check + test tay: mua du xu, thieu xu, tat DM, redeem lai, **tat DM roi bat lai va thu redeem** (phai bi tu choi).

## Todo

- [ ] Quyet cho luu link (env), kiem tra `.gitignore`
- [ ] Catalog hang so + gia + dong chinh sach khong hoan xu
- [ ] Ham mua 2 pha dung `ShopPurchase.status` (PENDING → DELIVERED/REFUNDED)
- [ ] DM loi → throw error DA LAM SACH (khong mang payload chua link)
- [ ] Hoan xu + set `REFUNDED` trong CUNG transaction
- [ ] Sweeper don `PENDING` treo luc khoi dong
- [ ] `/shop redeem` chi `DELIVERED`, ephemeral, chan `REFUNDED`
- [ ] Rà `interactionCreate.ts:154,161` — duong mua khong log error goc
- [ ] Redact URL host giao hang trong `report-chunk-collector`
- [ ] Self-check assert 4 muc
- [ ] `npm run build` + test tay 5 tinh huong

## Success Criteria

- [ ] Mua plugin du xu → tru dung gia, nhan DM co link, don `DELIVERED`
- [ ] Mua khi thieu xu → tu choi, khong tru, khong DM
- [ ] **Mua khi tat DM → xu duoc hoan, don `REFUNDED`; bat DM lai roi `/shop redeem` → BI TU CHOI** (khong duoc nhan plugin mien phi)
- [ ] Mua trung mon da so huu → bi chan, huong sang `/shop redeem` mien phi
- [ ] Nguoi CHUA mua goi `/shop redeem` → tu choi, khong lo link
- [ ] Bot chet giua 2 pha → sweoper luc khoi dong xu ly don `PENDING`, nguoi dung khong mat xu
- [ ] **DM that bai → grep log host: khong co link nao** (ke ca trong stack trace)
- [ ] **Dan link vao kenh chat → ban tin 21h khong dang lai link do**
- [ ] Link that khong bi commit vao git
- [ ] `npm run db:restore --replace` → don hang van con (nho Phase 5)
- [ ] `npm run build` + self-check pass

## Risk Assessment

| Rui ro | Muc | Giam thieu |
|--------|-----|-----------|
| **Hoan xu + redeem = plugin mien phi** | **CRITICAL** | `status` DELIVERED/REFUNDED; redeem chi `DELIVERED`; refund+status cung transaction |
| **Link lo qua `console.error(error)` / botLog** | **CRITICAL** | Buoc 4 + 7: throw error da lam sach, khong dua object goc vao log |
| **Nhat bao dang lai link ra forum + in vao anh PNG** | Cao | Buoc 8: redact URL o chunk collector |
| Don `PENDING` treo → mat xu | Cao | Sweeper luc khoi dong (buoc 5) |
| Restore backup xoa so don | Cao | Phase 5 them `ShopPurchase` vao `db-utils.js` |
| Link bi chia se lai | Trung | **User da chap nhan**; ghi ro trong mo ta mon |
| Tranh cai ve gia / doi gia | Trung | Niem yet gia + chinh sach tu dau |
| Gia qua cao → khong ai mua | Thap | Do "xu tieu vao hang that/thang"; bang 0 → ha gia |
| Alt farm xu mua hang | Thap | Khong co cho → alt khong chuyen duoc xu; user da chot khong chan |

**Ghi lai cho tuong lai**: neu sau nay mo cho giua nguoi choi hoac them duong chuyen xu, rui ro alt quay lai ngay va luc do moi can cong chan.
