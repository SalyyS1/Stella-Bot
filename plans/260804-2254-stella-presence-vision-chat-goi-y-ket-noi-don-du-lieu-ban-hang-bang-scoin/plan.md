---
title: "Stella presence: vision chat, goi y ket noi, don du lieu, ban hang bang scoin"
description: "Bien Stella tu bot tra loi thanh thanh vien co mat: nhin duoc anh trong chat, chu dong goi y ket noi nguoi voi nguoi trong nhat bao. Kem don du lieu chet va mo them sink kinh te (ban plugin/docs bang scoin)."
status: pending
priority: P1
effort: "3-4d"
tags: [ai, vision, community, economy, cleanup]
created: 2026-08-04
blockedBy: []
blocks: []
---

# Stella presence: vision chat, goi y ket noi, don du lieu, ban hang bang scoin

## Overview

Bot da truong thanh (34 Prisma model, 9 he thong cong dong, nhat bao AI map-reduce chay on). Nhung Stella **bi dong**: chi noi khi bi goi, khong thay anh nguoi gui du gateway ho tro vision, khong dung `MemberFact` da tich vao viec gi ngoai nhoi vao prompt QA.

Plan nay lam 3 dot: (1) Stella co mat — thay anh + chu dong goi y ket noi; (2) don du lieu chet + noi showcase/job vao bao; (3) mo sink kinh te — ban plugin/docs bang scoin.

Nguon: `plans/reports/advise-260804-2106-stella-presence-ai-features-report.md`

## Quyet dinh da chot (tu phien advise)

| # | Quyet dinh | Ghi chu |
|---|-----------|---------|
| 1 | Muc goi y ket noi: **nhom KHONG neu ten** | DOI sau red-team (ban dau chot neu ten). Ly do: server nhieu tre vi thanh nien, he thong khong co tin hieu tuoi nao (`Birthday` khong luu nam) → bot ghep doi co the ghep em 13 tuoi voi nguoi la. Khong neu ten → khong can opt-out, khong can migration |
| 2 | `expertScore` **KHONG bo, KHONG viet writer moi** | Da co writer that (`voteManager.ts:107`); chi xac nhan kenh con khop |
| 3 | Su kien AI co thuong scoin | Thuong lay tu tien ve, KHONG in xu moi |
| 4 | Gia: **plugin 1000-1500, docs 300-500** | Moc: role mau 200, star tool 250-1400 |
| 5 | Giao hang: **bot tu DM link tai ngay** | Khong can owner lam gi |
| 6 | **Khong** dat muc toi thieu chong alt | Hop ly: khong co cho (alt khong chuyen duoc xu) |
| 7 | **Bo** cho/dau gia giua nguoi choi | Khong phai sink that, lam lam phat te hon |

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Stella tra loi duoc cau hoi kem anh trong chat (`!s`, `/ask`) | P1 |
| 2 | Nhat bao co muc "GOI Y KET NOI" (chu de + so nguoi, khong neu ten) | P1 |
| 3 | Xoa du lieu chet (`TriviaWin`, `config.digest`), xac nhan `expertScore` | P2 |
| 4 | Showcase thang + job xong len duoc nhat bao | P2 |
| 5 | Mo rong shop + doc `ShopPurchase` (`/shop history`) | P2 |
| 6 | Ban plugin/docs bang scoin, bot tu DM link tai | P2 |

## Phases

| # | Phase | Status | Priority |
|---|-------|--------|----------|
| 1 | [Chuan bi & xac nhan ha tang](./phase-01-start.md) | Pending | P1 |
| 2 | [Vision chat - Stella nhin duoc anh](./phase-02-vision-chat-stella-nhin-duoc-anh.md) | Pending | P1 |
| 3 | [Goi y ket noi trong nhat bao](./phase-03-goi-y-ket-noi-trong-nhat-bao.md) | Pending | P1 |
| 4 | [Don du lieu chet + noi showcase/job vao bao](./phase-04-don-du-lieu-chet-va-noi-showcase-job-vao-bao.md) | Pending | P2 |
| 5 | [Mo rong shop + so don hang](./phase-05-mo-rong-shop-va-so-don-hang.md) | Pending | P2 |
| 6 | [Ban plugin/docs bang scoin](./phase-06-ban-plugin-docs-bang-scoin.md) | Pending | P2 |

## Dependencies

```
Phase 1 (xac nhan ha tang)
  |-> Phase 2 (vision chat)        -- doc lap
  |-> Phase 3 (goi y ket noi)      -- doc lap
  |-> Phase 4 (don du lieu)        -- doc lap
       |-> Phase 5 (mo rong shop)  -- can ShopPurchase doc duoc truoc
            |-> Phase 6 (ban hang) -- dung so don cua Phase 5
```

Phase 2, 3, 4 doc lap nhau → chay song song duoc. Phase 5 → 6 tuan tu.

## Phat hien quan trong khi scout (anh huong plan)

1. **`askAI` da tu retry text khi gateway tu choi anh** (`aiClient.ts:260`) + `stripImageParts` xoa luon cau dan "xem anh" — nen vision chat **khong can capability probe**, fail-soft da co san. Phase 2 nho hon du kien.
2. **`AiMessage.content` da nhan `AiContentPart[]`** (`aiClient.ts:23-26`) — type da san sang multimodal, chi `aiQaManager.ts:208` dang truyen string.
3. **`report-image-collector.ts:20,103`** da co whitelist `cdn.discordapp.com` + check `contentType.startsWith('image/')` → **tai dung, khong viet lai** (DRY).
4. **`Giveaway.entryCost` da chay** — sink "ve giveaway" khong can code, chi can dat gia tri. Khong dua vao plan nay.
5. **`expertScore` co writer that** — scout vong 1 bao sai. Da verify `voteManager.ts:107,194` + `voteBackfillManager.ts:315`. Nhung `scoreDelta` (`:21-34`) cho thay diem chi tang o **dung 1 kenh**: `config.channels.showcase`. Diem = 0 khap noi thi nguyen nhan la khong ai vote up trong showcase, hoac ID kenh lech — KHONG phai thieu writer.
6. **`aiQaManager` CO Y khong biet toi discord.js** (comment `aiQaManager.ts:167-169`) → `answerQuestion` phai nhan **mang URL string**, khong nhan `Attachment`. Caller loc truoc.
7. **`AskOpts.imageInstruction` la option that** (`aiClient.ts:64-72`, dung o `:265`) → buoc "truyen cau dan xem anh de strip dung luc fallback" kha thi voi signature hien tai.
8. **`node_modules` chua duoc cai** (`@prisma/client` khong resolve) → Phase 1 phai `npm install` truoc moi viec khac; khong query duoc DB truoc do.

## Ket qua red-team (2 reviewer doi khang, 2026-08-04)

Da chay 2 reviewer song song. **Ca hai deu tim ra loi that co bang chung code.** Da vao plan:

| # | Finding | Muc | Da xu ly |
|---|---------|-----|----------|
| 1 | `buyColorRole` **KHONG atomic** — 4 transaction roi rac, plan ban dau ghi "copy y nguyen" la SAI | CRITICAL | Phase 5 doi sang mau `star.ts:355-378` (row lock + 1 transaction) |
| 2 | Hoan xu + redeem = **plugin mien phi** (tra 0 xu van co hang) | CRITICAL | Phase 6 them `ShopPurchase.status`; redeem chi `DELIVERED` |
| 3 | `extractFact` chay vo dieu kien → **mo ta anh thanh MemberFact roi len nhat bao**, pha vo dam bao `config.ts:414` | CRITICAL | Phase 2 chan `extractFact` khi co anh |
| 4 | Link tai **lo qua `console.error(error)`** (DiscordAPIError mang `requestBody.json`) + stack vao kenh botLog | CRITICAL | Phase 6 throw error da lam sach |
| 5 | `ShopPurchase` **khong nam trong backup** → restore xoa sach so don hang | CRITICAL | Phase 5 them vao `db-utils.js` |
| 6 | Double-click mua → **double-spend** (TOCTOU giua check so huu va tru xu) | CRITICAL | Phase 5: lock + check trong transaction + unique constraint |
| 7 | Neu ten + ghep doi nguoi trong server nhieu **tre vi thanh nien**, khong co tin hieu tuoi nao | CRITICAL | **User doi sang nhom khong neu ten** |
| 8 | Prompt nhom thieu guard injection → 1 fact nhiem doc ban 8+ ngay output + anh PNG vinh vien | CRITICAL | Phase 3 boc tag + ignore-instructions + validate JSON |
| 9 | Query `MemberFact` khong gate `memory.enabled` → cong tat khan cap **van cong bo** du lieu cu | CRITICAL | Phase 3 gate |
| 10 | **Ca he vote co the chet ngam** neu emoji custom bi upload lai (ID parse luc load module) | HIGH | Phase 1 xac nhan emoji ID |
| 11 | Nhat bao **dang lai link tai** ra forum + in vao anh PNG (kenh chat nam trong `sourceChannels`) | HIGH | Phase 6 redact URL o chunk collector |
| 12 | `SYSTEM_PROMPT` khong co clause nao ve anh → Stella co the doc to screenshot tin nhan rieng cua nguoi khac | HIGH | Phase 2 them clause tu choi |
| 13 | `429` bi coi la "payload bi tu choi" → go anh + ban request thu 2 vao gateway dang rate-limit | HIGH | Phase 2 loai 429/401/403 |
| 14 | `/shop history` co the lo don cua nguoi khac neu copy mau `/scoin history` | HIGH | Phase 5: self-only + ephemeral |
| 15 | Cooldown 20s cho phep ~8.600 anh/ngay/nguoi, va la per-user | HIGH | Phase 2 them han muc/ngay co con so |
| 16 | Refund tang `scoinEarnedTotal` → sai leaderboard | MEDIUM | Phase 5 |
| 17 | Publisher thieu `allowedMentions` → body co the ping that | MEDIUM | Phase 3 |
| 18 | Xoa `TriviaWin` ma khong xoa relation field → `prisma generate` fail | MEDIUM | Phase 4 |
| 19 | Fact khong co gioi han tuoi → fact 8 tuan truoc dang nhu so thich hien tai | MEDIUM | Phase 3 loc 14 ngay |

**Reviewer cung xac nhan 4 claim ha tang cua plan la DUNG**: `askAI` retry text khi bi tu choi anh, `stripImageParts` xoa cau dan, `AskOpts.imageInstruction` la option that caller truyen duoc, `AiMessage.content` nhan `AiContentPart[]`.

## Success Criteria

- [ ] Gui anh build + hoi → Stella mo ta dung noi dung anh (>= 8/10 lan thu tay)
- [ ] Anh ngoai Discord CDN → bo qua, 0 loi runtime
- [ ] Spam anh lien tiep → cooldown chan, 0 lan vuot han muc/ngay
- [ ] Muc "GOI Y KET NOI" xuat hien 7/7 ngay tuan dau, **khong neu ten ai**
- [ ] `STELLA_MEMORY_ENABLED=false` → muc khong xuat hien (cong tat co tac dung that)
- [ ] Fact chua cau ra lenh → khong lam doi noi dung muc (chong prompt injection)
- [ ] Ban tin co `<@id>` trong body → khong ping ai (`allowedMentions`)
- [ ] Hoi kem anh → KHONG tao `MemberFact` moi (chong ro ri anh vao nhat bao)
- [ ] `TriviaWin` + `config.digest` chet: 0 con lai trong repo
- [ ] Kenh tinh `expertScore` xac nhan khop, vote thu → diem tang
- [ ] Showcase thang / job xong len nhat bao 100% tuan dau
- [ ] `/shop history` doc duoc `ShopPurchase` da ghi
- [ ] Mua plugin/docs → tru scoin dung, bot DM link tai, don ghi vao `ShopPurchase`
- [ ] Mua khi khong du scoin → tu choi, khong tru, khong DM
- [ ] `npm run build` sach + self-check pass, khong giam so assertion

## Rui ro chinh

| Rui ro | Muc | Giam thieu |
|--------|-----|-----------|
| Prompt injection qua `MemberFact` lam ban 8+ ngay output + anh bao vinh vien | Cao | Guard tag + ignore-instructions + validate JSON + check khong-quote (Phase 3) |
| Mo ta anh ro ri thanh `MemberFact` roi len nhat bao | Cao | Chan `extractFact` khi co anh (Phase 2) — bat buoc |
| Cong tat memory khong co tac dung (van cong bo du lieu cu) | Cao | Gate `config.memory.enabled` trong query (Phase 3) |
| Link tai bi chia se lai cho nguoi khong tra xu | Trung | User da chap nhan trade-off nay; ghi ro trong mo ta mon hang |
| Spam anh de treu bot / ton quota | Trung | Cooldown + han muc anh/ngay/nguoi co con so cu the (Phase 2) |
| Xoa `TriviaWin` lam mat cap trivia | Thap | Cap dang dem qua `ScoinTransaction`, khong qua `TriviaWin` — verify truoc khi xoa |
| Gia plugin qua cao → khong ai mua | Thap | Do "xu tieu vao hang that/thang"; bang 0 thi ha gia |

## Ngoai pham vi (khong lam trong plan nay)

- Cho/dau gia giua nguoi choi (user da bo)
- Cong chan alt / muc toi thieu (user da bo, hop ly vi khong co cho)
- Su kien AI dan chuyen (plan rieng, dot 4)
- Ve giveaway bang scoin (`entryCost` da chay san, chi can dat gia tri)

<!-- slug: stella-presence-vision-chat-goi-y-ket-noi-don-du-lieu-ban-hang-bang-scoin -->
