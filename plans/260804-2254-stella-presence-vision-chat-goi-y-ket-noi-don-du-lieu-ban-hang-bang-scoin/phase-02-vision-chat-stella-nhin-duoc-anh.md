---
phase: 2
title: "Vision chat - Stella nhin duoc anh"
status: pending
priority: P1
effort: "3h"
dependencies: [1]
---

# Phase 2: Vision chat - Stella nhin duoc anh

## Overview

Cho Stella "thay" anh nguoi gui trong chat (`!s`, `/ask`). Ha tang da co gan het — day la **noi day**, khong phai tinh nang moi.

## Requirements

- Functional: cau hoi kem anh → Stella tra loi dua tren noi dung anh; toi da 2 anh/cau
- Functional: chi nhan anh tu Discord CDN (chong SSRF / link ngoai)
- Non-functional: cooldown rieng cho cau kem anh (chong spam anh treu bot)
- Non-functional: fail-soft — gateway tu choi anh thi tra loi text, KHONG noi "toi khong thay anh"

## Architecture

Ha tang da san (verified khi scout):

| Thanh phan | Trang thai |
|-----------|-----------|
| `AiMessage.content` nhan `AiContentPart[]` | DA CO (`aiClient.ts:23-26`) |
| `askAI` retry text khi gateway tu choi anh | DA CO (`aiClient.ts:260`) |
| `stripImageParts` bo luon cau dan "xem anh" | DA CO (`aiClient.ts:48`) |
| Whitelist `cdn.discordapp.com` + check `contentType` | DA CO (`report-image-collector.ts:20,103`) |
| `aiQaManager` truyen anh vao `askAI` | **THIEU** — day la viec can lam |

Luong: `messageCreate`/`ask.ts` → lay `message.attachments` → loc (host + contentType) → `answerQuestion(..., images)` → dung `AiContentPart[]` cho turn user cuoi → `askAI`.

**DRY quan trong**: logic loc anh KHONG viet lai. Tach ham loc dung chung tu `report-image-collector` (hoac import truc tiep neu export duoc) — mot nguon su that cho "anh nao duoc phep".

## CHAN TREN (red-team finding, BAT BUOC)

**`extractFact` chay tren MOI cau tra loi** (`aiQaManager.ts:216` — fire-and-forget, khong dieu kien). Phase 2 lam `answer` thanh **mo ta noi dung anh** → mo ta anh bien thanh `MemberFact` ben vung trong DB → Phase 3 **cong bo len nhat bao**.

Dieu nay pha vo dam bao da ghi trong `config.ts:414`: *"Anh khong bao gio duoc luu — chi co URL di vao mot luot goi AI roi mat."*

Vi du that: thanh vien chup anh thoi khoa bieu / anh phong minh, hoi "doc duoc khong". Stella mo ta. `extractFact` luu "Hay hoi ve bai tap tren lop". 21h: ban tin in "GOI Y KET NOI — Minh va Lan deu hay hoi chuyen hoc".

→ **BAT BUOC: khi `imageUrls.length > 0`, KHONG goi `extractFact`.** Khong phai tuy chon, khong phai "nen". Them assert vao self-check.

## Rang buoc kien truc DA VERIFY (khong duoc pha)

1. **`aiQaManager` CO Y khong biet toi discord.js.** Comment `aiQaManager.ts:167-169` noi ro: `emojiHint` duoc truyen vao thay vi doc trong module, "de module nay khong can biet toi discord.js — no van chi la tang goi AI".
   → Vi vay `answerQuestion` **KHONG nhan `message.attachments`**. Caller (`messageCreate.ts` / `ask.ts`) phai loc truoc, truyen vao **mang URL string** (`imageUrls: string[]`). Giu dung rang buoc nay, khong import discord.js vao `aiQaManager`.

2. **`AskOpts.imageInstruction` la option THAT** (`aiClient.ts:64-72`) — caller truyen duoc, va duoc dung o retry path (`aiClient.ts:265`: `stripImageParts(messages, opts.imageInstruction)`). Comment tai cho noi ro: truyen vao thay vi hardcode "vi aiClient dung chung cho moi tinh nang AI, khong duoc mang prompt cua rieng tinh nang nao".
   → Buoc 3 kha thi voi signature that. Truyen `imageInstruction` qua `opts` khi goi `askAI`.

3. **`askAI` da retry text khi gateway tu choi anh** (`aiClient.ts:253-265`) — khong can capability probe, khong can try/catch rieng cho vision o `aiQaManager`.

## Related Code Files

- Modify: `src/systems/aiQaManager.ts` — `answerQuestion` nhan tham so `images`, dung multimodal cho turn user
- Modify: `src/systems/report/report-image-collector.ts` — export ham loc anh de dung chung (hoac tach ra module rieng neu import cheo gay vong)
- Modify: `src/events/messageCreate.ts` — truyen `message.attachments` vao `answerQuestion`
- Modify: `src/commands/ask.ts` — tuong tu cho slash command (neu slash nhan attachment)
- Modify: `src/config.ts` — them cooldown + gioi han so anh/cau
- Modify: `scripts/self-check.js` — assert vision chat khong lam mat fail-soft

## Implementation Steps

1. Tach ham loc anh dung chung: nhan `attachments`, tra ve mang URL hop le (host trong whitelist + `contentType` bat dau `image/`), cap so luong theo config. Dat o cho ca `report-image-collector` va caller cua `aiQaManager` dung duoc — khong duplicate whitelist. **Ham nay o tang co discord.js**, khong nam trong `aiQaManager`.
2. `answerQuestion(...)`: them tham so `imageUrls?: string[]` (**mang URL string, KHONG phai Attachment** — xem rang buoc 1 o tren). Khi co anh, turn user cuoi doi tu `content: string` sang `content: AiContentPart[]` (1 part text + N part `image_url`).
3. Them cau dan trong system turn khi co anh (vd "Nguoi dung gui kem anh, hay xem anh de tra loi") VA truyen **cung chuoi do** vao `askAI(messages, { imageInstruction })`. Hai cho phai la MOT chuoi — neu lech thi `stripImageParts` khong xoa duoc cau dan luc fallback, model se noi "toi khong thay anh" (bug da ghi `aiClient.ts:44-47`). Dat chuoi thanh const dung chung.
4. **Chan `extractFact` khi co anh**: `aiQaManager.ts:216` dang goi vo dieu kien. Sua thanh chi goi khi `imageUrls` rong. (Xem "CHAN TREN" o dau file — day la muc bat buoc.)
5. Them clause tu choi mo ta anh rieng tu vao `SYSTEM_PROMPT`: giay to/CMND, anh mat nguoi, anh chup tin nhan rieng cua nguoi khac, tai lieu ca nhan. `SYSTEM_PROMPT` (`aiQaManager.ts:51-92`) hien **khong co clause nao ve anh** — duong bao ve cua duong report nam o prompt rieng, khong dung chung. Day la Todo that, khong phai suy dien.
6. `messageCreate.ts` + `ask.ts`: lay attachments, loc, truyen vao.
7. Cooldown rieng + **han muc anh/ngay/nguoi** (khong chi cooldown): cooldown 20s cho phep ~8.600 anh/ngay/nguoi, va cooldown la per-user nen 30 nguoi song song la khong gioi han. Dat con so ro trong `config.ts`.
8. Cap so anh: toi da 2 anh/cau (config).
9. **429 khong duoc coi la "payload bi tu choi"**: `aiClient.ts:207` phan loai `res.status >= 400 && < 500` la `rejected` → 429 (rate limit) lot vao, khien bot go bo anh VA ban thu 2 ngay lap tuc vao gateway dang bi limit. Sua: loai 429 (va 401/403) khoi `rejected`.
10. Khi anh bi go vi ly do khac (gateway that su khong nhan vision): o duong CHAT phai **noi that** ("minh chua xem duoc anh, mo ta giup minh") — khac duong report noi im lang la dung. Sua lai success criteria cho khop.
11. Self-check assert: (a) `extractFact` khong chay khi co anh, (b) `imageInstruction` duoc truyen, (c) `SYSTEM_PROMPT` co clause tu choi anh rieng tu.
12. `npm run build` + self-check.

## Todo

- [ ] Tach ham loc anh dung chung (khong duplicate whitelist)
- [ ] `answerQuestion` nhan `imageUrls: string[]`, dung `AiContentPart[]` cho turn user
- [ ] Cau dan xem anh = const dung chung, truyen vao `askAI({ imageInstruction })`
- [ ] **CHAN `extractFact` khi `imageUrls` khong rong** (bat buoc — chong ro ri anh vao MemberFact/nhat bao)
- [ ] **Them clause tu choi mo ta anh rieng tu vao `SYSTEM_PROMPT`** (giay to, mat nguoi, screenshot tin nhan nguoi khac)
- [ ] Noi `messageCreate.ts` + `ask.ts`
- [ ] Cooldown rieng + **han muc anh/ngay/nguoi** co con so cu the trong config
- [ ] Cap 2 anh/cau
- [ ] Loai 429/401/403 khoi `rejected` (`aiClient.ts:207`)
- [ ] Duong chat: khi anh bi go thi NOI THAT, khong im lang nhu duong report
- [ ] Self-check assert: extractFact bi chan + imageInstruction + clause anh rieng tu
- [ ] `npm run build` sach

## Success Criteria

- [ ] Gui anh build Minecraft + hoi "nha nay the nao" → Stella mo ta dung (>= 8/10 lan thu tay)
- [ ] Gui anh tu host ngoai Discord → bo qua, tra loi text binh thuong, 0 loi runtime
- [ ] Gui 5 anh 1 luc → chi 2 anh dau duoc dung, khong loi
- [ ] Spam anh lien tiep → cooldown chan; vuot han muc/ngay → tu choi ro rang
- [ ] **Hoi kem anh → KHONG co `MemberFact` moi nao duoc tao** (kiem tra DB truoc/sau)
- [ ] Gui anh CMND / screenshot tin nhan nguoi khac → Stella tu choi mo ta
- [ ] Gateway that su khong nhan vision → Stella noi that la chua xem duoc anh (khac duong report)
- [ ] Gap 429 → khong go anh, khong ban lien tiep 2 request
- [ ] `npm run build` + self-check pass, so assertion khong giam

## Risk Assessment

- **Cau dan "xem anh" khong bi strip khi fallback** → model tra loi "toi khong thay anh nao" = dung bug ma `aiClient.ts:44-47` canh bao. Giam thieu: buoc 3 + self-check assert o buoc 7.
- **Import cheo `report-image-collector` <-> `aiQaManager` gay vong** → neu co, tach ham loc ra module rieng (`src/systems/discord-image-filter.ts` hoac tuong tu). Kiem tra khi code.
- **Spam anh ton quota**: gateway mien phi nhung van co rate-limit. Cooldown rieng la bat buoc, khong phai tuy chon.
- **Anh NSFW / anh xau** nguoi dung gui de treu: ngoai pham vi plan nay; neu xay ra thi xu ly bang moderation san co.
