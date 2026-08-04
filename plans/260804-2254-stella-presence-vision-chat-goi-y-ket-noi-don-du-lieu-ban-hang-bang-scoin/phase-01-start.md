---
phase: 1
title: "Chuan bi & xac nhan ha tang"
status: pending
priority: P1
effort: "1h"
dependencies: []
---

# Phase 1: Chuan bi & xac nhan ha tang

## Overview

Xac nhan 3 gia dinh ha tang truoc khi code, tranh xay tren nen sai. Khong viet feature — chi verify + ghi lai ket qua.

## Rang buoc moi truong DA PHAT HIEN

**`node_modules` chua duoc cai trong repo nay** (`@prisma/client` khong resolve). Nen:

- Khong query duoc DB tu may nay de dem `MemberFact` / `expertScore`
- Buoc 3 va 4 phai chay **sau khi `npm install`**, hoac chay tren host dang chay bot
- `npm run build` cung can `node_modules` (script co `prisma generate && tsc`)

→ Viec dau tien cua phase nay: `npm install`. Neu khong cai duoc thi cac buoc verify DB phai chay tren host.

**Da verify duoc bang doc code (khong can DB):**

- `expertScore` chi tang o **1 kenh duy nhat**: `config.channels.showcase` (`voteManager.ts:25`). Kenh `share` chi tang `contributionScore` (`:29`). Moi kenh khac → 0 ca hai.
- ID kenh dang cau hinh: `showcase = "1401215370978922506"`, `share = "1401215533243957388"` (`config.ts:73-74`).
- **CA HE VOTE CO THE CHET NGAM**: `voteManager.ts:10-11` parse emoji ID bang regex tu `config.ui.emojis.upvote/downvote` **luc load module**. Neu 2 emoji custom (`tanh_plusone:1497592408316055612`, `MinusOne:1497592465430151239`) da bi xoa hoac upload lai (snowflake moi) thi `voteValueFromEmoji` tra `null` cho MOI reaction → `expertScore`, `contributionScore`, VA thuong +2 scoin **ngung hoat dong hoan toan** trong khi code van nguyen ven. Day la kieu loi khong the phat hien bang doc code.
- Kenh `betterShowcase` (`config.ts:75`) la noi showcase da duyet nam. Vote o day **khong tinh diem gi**. Neu cong dong thuc te vote o ban forum thi `expertScore` = 0 la dung ky thuat.

## Requirements

- Functional: xac nhan vision gateway con hoat dong, kenh `expertScore` con khop, `MemberFact` co du du lieu de goi y ket noi
- Non-functional: khong doi hanh vi runtime; chi doc

## Architecture

3 kiem tra doc lap, chay duoc song song:

1. **Vision gateway**: `askAI` da co fail-soft (`aiClient.ts:260` retry text khi bi tu choi anh). Can biet gateway HIEN TAI con nhan anh khong — neu khong thi Phase 2 van lam duoc (degrade thanh text) nhung phai noi ro voi user.
2. **`expertScore` kenh**: `voteManager.scoreDelta(channelId, ...)` phan loai kenh chuyen mon vs kenh gop y. Neu ID kenh trong config da doi thi diem ngung tang ma khong ai biet.
3. **`MemberFact` du lieu**: fact la **text tu do tieng Viet** (`EXTRACT_PROMPT` tra ve cau nhu "Thich xay nha go"), KHONG co field so thich co cau truc. Phase 3 phai nhom bang AI, khong query duoc bang SQL. Can biet hien co bao nhieu fact / bao nhieu nguoi.

## Related Code Files

- Doc: `src/systems/aiClient.ts` (fail-soft path), `src/systems/voteManager.ts` (scoreDelta), `src/config.ts` (channel IDs)
- Doc: `prisma/schema.prisma` (`MemberFact`)
- Ghi: `plans/260804-2254-.../reports/phase-01-ha-tang-xac-nhan-report.md`

## Implementation Steps

1. **`npm install`** truoc tien — `node_modules` chua co, khong co no thi khong query DB va khong build duoc.
2. Probe vision: goi `askAI` voi 1 anh Discord CDN thuc + cau hoi "mo ta anh nay". Ghi lai: nhan anh / bi tu choi (retry text).
3. Xac nhan 2 ID kenh `showcase` (`1401215370978922506`) va `share` (`1401215533243957388`) con ton tai va con dung muc dich.
4. **Xac nhan 2 emoji vote con ton tai** trong guild (doi chieu `1497592408316055612` / `1497592465430151239` voi danh sach emoji that). Neu lech → ca he vote dang chet ngam, phai sua config truoc moi viec khac.
5. Vote thu 1 bai trong **kenh `showcase` goc** (khong phai `betterShowcase`) → kiem tra `expertScore` tang.
6. Query so luong `MemberFact`: tong so fact, so user co fact.
7. **Doc TOAN BO `MemberFact` de soat quyen rieng tu** (khong chi 10-20 dong mau): tim fact nao `EXTRACT_PROMPT` da de lot ma khong nen cong bo. Phase 3 se dua chung vao AI nhom — soat truoc re hon soat sau khi da dang.
8. Neu `MemberFact` qua it (< 10 nguoi) → BAO NGAY cho user: Phase 3 se ra muc rong, nen bat `STELLA_MEMORY_ENABLED` va cho tich vai ngay.
9. Ghi report ket qua.

## Todo

- [ ] `npm install` (bat buoc truoc moi buoc khac)
- [ ] Probe vision gateway bang 1 anh Discord CDN that
- [ ] Xac nhan ID kenh showcase/share con dung
- [ ] **Xac nhan 2 emoji vote con ton tai trong guild** (ca he vote co the chet ngam)
- [ ] Vote thu trong kenh `showcase` goc → `expertScore` tang
- [ ] Query so luong `MemberFact`
- [ ] **Doc toan bo `MemberFact` soat quyen rieng tu** (khong chi mau)
- [ ] Ghi report, bao user neu `MemberFact` qua it

## Success Criteria

- [ ] `npm install` xong, `npm run build` chay duoc
- [ ] Biet ro gateway co nhan anh khong (co bang chung, khong phong doan)
- [ ] Xac nhan 2 emoji vote + 2 ID kenh con dung; vote thu → `expertScore` tang that
- [ ] Biet so nguoi co `MemberFact` — du de lam Phase 3 hay chua
- [ ] Da soat toan bo fact, khong con fact nhay cam nao se bi cong bo o Phase 3
- [ ] Report ghi lai ket qua, khong doi code nao (tru sua config neu emoji/kenh lech)

## Risk Assessment

- **Gateway khong nhan anh**: Phase 2 van lam duoc (fail-soft san) nhung gia tri giam manh → phai bao user truoc khi code, de user quyet co lam tiep khong.
- **`MemberFact` rong**: Phase 3 vo nghia neu khong co du lieu. Phat hien som o day re hon phat hien sau khi code xong.
