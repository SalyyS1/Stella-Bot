# Phase 1 — Ket qua xac nhan ha tang

Ngay: 2026-08-04 | Plan: `plans/260804-2254-stella-presence-.../`

## 1. Vision gateway: HOAT DONG

Probe that voi anh Discord CDN (`cdn.discordapp.com/embed/avatars/0.png`) qua `askAI` multimodal:

- Ket qua: **"Logo Discord."** — mo ta dung, khong phai `KHONG-THAY-ANH`
- → Gateway nhan `image_url` va model doc duoc anh. Phase 2 lam duoc day du, khong phai degrade.

## 2. He vote: DANG CHAY (red-team lo hoi qua)

Red-team canh bao emoji ID co the lech lam ca he vote chet ngam. **Khong xay ra:**

| Chi so | Gia tri |
|--------|---------|
| Tong vote | 486 |
| User co `expertScore > 0` | **24** |
| User co `contributionScore > 0` | 21 |
| Vote gan nhat | 2026-08-04 13:20 (hom nay) |

→ Emoji ID con khop, kenh `showcase`/`share` con dung, writer `expertScore` chay binh thuong. **Phase 4 khong can sua gi ve `expertScore`.**

Ket luan ban dau cua scout vong 1 ("expertScore khong co writer, luon = 0") la **sai hoan toan** — 24 nguoi dang co diem.

## 3. `MemberFact`: DU DUNG cho Phase 3

| Chi so | Gia tri |
|--------|---------|
| Tong fact | 35 |
| So nguoi co fact | **9** |
| Fact cu nhat | 2026-07-25 |
| Fact moi nhat | 2026-08-04 |
| Fact trong 14 ngay | **35 / 9 nguoi (100%)** |

→ `STELLA_MEMORY_ENABLED` dang BAT va dang tich fact that. 9 nguoi la it nhung du de nhom 2-3 chu de.

**Loc 14 ngay khong lam mat gi** (toan bo 35 fact deu trong 14 ngay) — nguong nay an toan, giu nguyen.

### Soat quyen rieng tu 35 fact: KHONG co fact nhay cam

Doc toan bo. Chu de thuc te:
- Lap trinh plugin Minecraft, MythicMobs, BetterHud, Skript (nhieu nhat)
- API LLM / OpenAI / model AI
- Blockbench animation
- Meme, dua voi bot (Skynet, `/op`, "ky Jura")
- Nhac gui release

Khong co fact nao dinh: tinh cam, drama, tuoi that, ten that, dia chi, truong lop, suc khoe, gia dinh. `EXTRACT_PROMPT` da lam dung viec.

**Nhom chu de tu nhien noi len**: "lap trinh plugin Minecraft" (>= 3 nguoi), "API AI/LLM" (>= 2 nguoi) → Phase 3 se co du lieu that de nhom.

## 4. `TriviaWin` va `ShopPurchase`: dang RONG

| Bang | So row |
|------|--------|
| `TriviaWin` | **0** |
| `ShopPurchase` | **0** |

→ `TriviaWin` chua bao gio duoc ghi (dung nhu red-team noi: 0 tham chieu code). **Xoa an toan, khong mat du lieu that.** Chon huong (a) trong Phase 4.

→ `ShopPurchase` rong nghia la **chua ai mua gi trong shop**. Migration them `status`/`unique` o Phase 5 khong can backfill, khong co don cu de lo.

## 5. Moi truong

- `npm install`: xong (2 vulnerabilities: 1 moderate, 1 high — chua xu ly, ngoai pham vi plan)
- `npm run build`: sach (exit 0)
- `npm test` (self-check): **77 assertions pass**

## Anh huong len cac phase sau

| Phase | Thay doi so voi plan |
|-------|---------------------|
| 2 | Khong doi — vision that su hoat dong, lam day du |
| 3 | Khong doi — 9 nguoi/35 fact du dung; nguong 14 ngay giu nguyen |
| 4 | **Bo viec sua `expertScore`** (dang chay dung, 24 nguoi co diem). `TriviaWin` chon huong (a) xoa — 0 row, an toan |
| 5 | Migration khong can backfill (`ShopPurchase` rong) |
| 6 | Khong doi |

## Cau chua giai quyet

Khong co. Ca 3 gia dinh ha tang da duoc xac nhan bang du lieu that.
