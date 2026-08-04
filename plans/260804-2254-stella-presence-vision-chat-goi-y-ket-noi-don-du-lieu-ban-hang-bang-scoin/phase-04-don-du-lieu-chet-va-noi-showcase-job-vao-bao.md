---
phase: 4
title: "Don du lieu chet va noi showcase job vao bao"
status: pending
priority: P2
effort: "3h"
dependencies: [1]
---

# Phase 4: Don du lieu chet va noi showcase/job vao bao

## Overview

Don 3 cho du lieu chet/sai va noi 2 he thong da co (showcase, job board) vao nhat bao. Khong tinh nang moi — sua thu nguoi dung dang thay sai.

## Requirements

- Functional: `expertScore` xac nhan chay dung (KHONG bo, KHONG viet writer moi)
- Functional: `TriviaWin` chet — xoa hoac dung that
- Functional: `config.digest` chet — xoa
- Functional: showcase thang vote + job hoan thanh → len nhat bao
- Non-functional: khong lam mat du lieu that khi xoa model

## Architecture

## KET QUA PHASE 1 — `expertScore` DANG CHAY, KHONG SUA GI

Da query DB that (`reports/phase-01-ha-tang-xac-nhan-report.md`):

| Chi so | Gia tri |
|--------|---------|
| Tong vote | 486 |
| User co `expertScore > 0` | **24** |
| Vote gan nhat | 2026-08-04 (hom nay) |
| `TriviaWin` rows | **0** |

→ **Bo hoan toan viec sua `expertScore`**: writer chay dung, emoji ID con khop, kenh `showcase` con dung. Ket luan "expertScore luon = 0" cua scout vong 1 la sai; 24 nguoi dang co diem.

→ `TriviaWin` co **0 row** → chon huong **(a) xoa**, khong mat du lieu that, khong can chuyen cap trivia.

**`TriviaWin`** (`schema.prisma:351`): 0 tham chieu trong code. Cap trivia dang dem qua `ScoinTransaction WHERE source='trivia:win'`. Hai lua chon:
- (a) Xoa model → don, nhung cap van phu thuoc ledger (prune ledger = reset cap ngam)
- (b) Chuyen cap sang dung `TriviaWin` → cap ben vung hon truoc prune

Khuyen nghi **(b)** neu ledger co ke hoach prune; **(a)** neu khong. Quyet khi code, ghi ly do.

**Noi showcase/job vao bao**: `gatherServiceBoard()` (`report-context-sources.ts:10`) dang la nguon context cho composer. Them 2 nguon tuong tu: showcase thang vote trong ngay, job hoan thanh trong ngay.

## Related Code Files

- Modify: `src/config.ts` — xoa `config.digest` (dead, 0 consumer); sua ID kenh `expertScore` neu Phase 1 bao lech
- Modify: `prisma/schema.prisma` + migration — `TriviaWin` (xoa hoac dung)
- Modify: `src/systems/trivia-manager.ts` — neu chon (b), doi cach dem cap
- Modify: `src/systems/report/report-context-sources.ts` — them nguon showcase + job
- Modify: `src/systems/report/report-daily-composer.ts` — nhan 2 nguon moi vao prompt
- Delete: `tmp_steal.ts`, `tmp_panel_state.json` (rac o goc repo)
- Modify: `scripts/self-check.js` — assert khong con `config.digest`

## Implementation Steps

1. Doc report Phase 1: `expertScore` kenh co khop khong. Khop → khong sua. Lech → sua ID kenh trong config, test vote thu.
2. `TriviaWin`: quyet (a) xoa hay (b) dung that, ghi ly do.
   - Neu (a): migration drop table **VA xoa relation field `triviaWins TriviaWin[]` tren `User` (`schema.prisma:42`)** — de sot thi `prisma generate` fail va dung build giua phase.
   - Neu (b): ghi row `TriviaWin` **trong cung transaction voi viec cong thuong** (hien `trivia-manager.ts:117` goi `adjustScoin` doc lap, cap doc `scoinTransaction.count` o `:60-62`); them index ghep `[userId, createdAt]` (hien 2 index roi rac `:360-361`); va **them `TriviaWin` vao `scripts/db-utils.js`** neu khong muon restore reset cap ngam.
   - Luu y: ly do "prune ledger = reset cap ngam" cho huong (a) la **gia dinh** — grep khong tim thay `scoinTransaction.deleteMany` o dau. Dung lay do lam ly do chinh de chon (b).
3. Xoa `config.digest` khoi `config.ts` (verify 0 consumer truoc khi xoa).
4. `report-context-sources.ts`: them ham lay showcase thang vote trong ngay + job hoan thanh trong ngay (theo mau `gatherServiceBoard`, cung fail-soft).
5. Noi 2 nguon vao `Promise.all` cua scheduler + chen vao prompt composer.
6. Xoa `tmp_steal.ts`, `tmp_panel_state.json`.
7. Self-check: assert `config.digest` khong con; assert nguon showcase/job co fail-soft.
8. `npm run build` + self-check + kiem tra migration khong mat du lieu that.

## Todo

- [ ] Xac nhan/sua ID kenh `expertScore` theo report Phase 1 (ke ca emoji vote neu lech)
- [ ] Quyet + thuc hien `TriviaWin`; neu xoa thi **xoa luon relation field tren `User` (`schema.prisma:42`)**
- [ ] Xoa `config.digest` (verify 0 consumer truoc — bo qua `dist/`, `host-package/` la artifact tu sinh)
- [ ] Them nguon showcase thang + job xong vao `report-context-sources`
- [ ] Noi 2 nguon vao scheduler + composer
- [ ] Xoa `tmp_steal.ts`, `tmp_panel_state.json`
- [ ] Self-check assert + `npm run build`

## Success Criteria

- [ ] Vote thu 1 bai trong kenh chuyen mon → `expertScore` tang (chung minh writer chay)
- [ ] `TriviaWin`: hoac khong con trong schema, hoac dang duoc dung that de dem cap
- [ ] Cap trivia van hoat dong dung sau khi doi (thu vuot cap)
- [ ] `config.digest` khong con trong repo
- [ ] Showcase thang vote hom nay → xuat hien trong ban tin 21h
- [ ] Job hoan thanh hom nay → xuat hien trong ban tin 21h
- [ ] Nguon showcase/job loi → bo qua, ban tin van dang
- [ ] `npm run build` + self-check pass, khong mat du lieu that

## Risk Assessment

- **Xoa `TriviaWin` roi phat hien can dung**: check `git log` xem model tung duoc dung chua truoc khi drop; migration co the revert nhung du lieu da mat thi khong.
- **Doi cach dem cap trivia lam sai cap**: test vuot cap sau khi doi, khong chi tin build sach.
- **Xoa `config.digest` nhung con cho dung an**: grep toan repo (ke ca `dist/`, `host-package/`) truoc khi xoa.
- **Nguon showcase/job lam prompt composer phinh** → vuot token: cap so item moi nguon (vd 5 gan nhat).
