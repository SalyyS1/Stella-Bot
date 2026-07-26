---
name: phase-04-birthday
status: pending
created: 2026-07-26T12:17:53Z
updated: 2026-07-26T12:17:53Z
---

# Phase 04 — Birthday System (Sinh nhật)

## Files to CREATE (own ONLY these; do NOT edit any other file)
- `src/systems/birthday-manager.ts`
- `src/commands/birthday.ts`

## Read first (context)
- `prisma/schema.prisma` → `Birthday` (userId @id, day, month, lastCelebratedYear)
- `src/config.ts` → `config.birthday` (enabled, channelId, announceHour, gift), `config.maintenance.timezone`, `config.ui.emojis`
- `src/systems/trivia-scheduler.ts` → scheduler pattern
- `src/systems/scoinManager.ts` → `adjustScoin`
- `src/commands/stella.ts` → VN subcommand style, ephemeral self-service pattern
- `src/utils/adminLog.ts` → `sendAdminLog`

## Requirements

### birthday-manager.ts
- Date validation: month-length table; 29/2 ALLOWED (celebrated Mar 1 in non-leap years); reject impossible dates (31/4, 30/2…).
- `setBirthday(userId, day, month)` / `getBirthday(userId)` / `clearBirthday(userId)` — prisma upsert/find/delete.
- `startBirthdayScheduler(client): void` — 15-min tick, busy flag:
  1. Skip unless enabled and current hour (in configured TZ, via Intl parts) === announceHour.
  2. Today parts {day, month, year} in configured TZ. Celebrants: `{ day, month }` matches today; PLUS when today is Mar 1 of a NON-leap year → also `{ day: 29, month: 2 }`.
  3. Per celebrant, atomic once-per-year claim: `birthday.updateMany({ where: { userId, OR: [{ lastCelebratedYear: null }, { lastCelebratedYear: { lt: year } }] }, data: { lastCelebratedYear: year } })` — `count === 1` → gift `adjustScoin(userId, gift, 'Quà sinh nhật 🎂', 'birthday:gift', String(year))`, add to announce list.
  4. One embed in `channelId` congratulating ALL of today's celebrants (mentions, 🎂🎉, gift note). VN copy. Send failure → `sendAdminLog` (gifts already paid — acceptable; claim prevents re-gift).

### commands/birthday.ts
- `/birthday dat ngay:<int 1-31> thang:<int 1-12>` — validate via manager; ephemeral confirm (mentions gift + announce channel).
- `/birthday xem` — own entry, ephemeral.
- `/birthday xoa` — delete own, ephemeral confirm.
- All defer-first, try/catch, VN copy.

## Success criteria
- Restart during celebration hour cannot double-gift (lastCelebratedYear claim precedes payment).
- 29/2 handled per rule above; invalid dates rejected with clear VN error.
- No edits outside owned files.
