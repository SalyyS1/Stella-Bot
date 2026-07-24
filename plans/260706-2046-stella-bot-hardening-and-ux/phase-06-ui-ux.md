---
phase: 6
title: "UI-UX"
status: in-progress
priority: P3
dependencies: [1, 2, 3]
---

# Phase 6: UI/UX & Usability

## Overview

Improve clarity and usability across the four areas the user selected: (1) error messages & feedback, (2) request board & rating, (3) giveaway embed & panel, (4) star game & music panel. Depends on Phases 1-3 because several UX changes (disabling rate buttons after use, button states reflecting status) are the visible half of the correctness fixes.

## Key Insights

- Error replies are raw: `error?.message` is surfaced directly to users (e.g. interactionCreate.ts:303, 168), leaking internal strings like "Not enough Scoin." and Vietnamese/English mix. Users get inconsistent tone.
- Request buttons already encode status→disabled logic (requestManager.ts:27-52) but the message isn't refreshed on every transition path, so buttons can look active when they're not.
- Rating flow: after rating, buttons should disappear (Phase 1 makes this atomic; here we ensure the UX — the update to `embeds:[], components:[]` at interactionCreate.ts:300 is correct, but a re-rate attempt on an already-consumed message gives a raw error).
- Giveaway embed (giveawayManager) shows prize/host/count; panel create modal exists. Missing: clear end-state visual, winner display consistency after reroll (Phase 2 replace semantics).
- Star game feedback is text frames + a rendered card (star.ts:374-417) — good; the gap is error copy and cooldown messaging clarity.
- Music panel (musicManager.musicPanel) — health command leaks host:port (Phase 4 gates it); here ensure the control panel gives clear "not in voice" / "no player" feedback rather than raw throws.

## Requirements

- Functional: consistent, friendly, localized error/feedback copy; button/embed states always reflect true status; no raw internal error strings shown to end users.
- Non-functional: no behavioral regression to the correctness fixes in Phases 1-3.

## Architecture

- Centralize user-facing error mapping: a small helper (e.g. `src/utils/userFacingError.ts`) that maps known thrown messages / error codes to friendly localized copy, with a generic fallback. Interaction handlers call it instead of interpolating `error.message` raw.
- Keep the `tr()` i18n layer as the source of copy strings; add keys for the new friendly messages.

## Related Code Files

- Create: `src/utils/userFacingError.ts` (map internal errors → friendly localized copy)
- Modify: `src/events/interactionCreate.ts` (route error replies through the helper; keep admin log with raw detail)
- Modify: `src/i18n/translations.ts` (add friendly error + feedback keys)
- Modify: `src/systems/requestManager.ts` (ensure refresh on every transition; friendly claim/close/complete/rate copy)
- Modify: `src/systems/giveawayManager.ts` (end-state embed clarity; winner display after replace-reroll)
- Modify: `src/systems/musicManager.ts` (clear no-voice / no-player feedback)
- Modify: `src/commands/star.ts` (friendly cooldown/area-locked/error copy)

## Implementation Steps

1. **Error helper:** create `userFacingError.ts` mapping known cases ("Not enough Scoin", "already claimed", expiry codes) to `tr()` keys with a generic fallback ("Có lỗi xảy ra, thử lại sau."). Admin log still records the raw stack/message.
2. **Route replies:** in interactionCreate.ts button/modal catch blocks, replace `error?.message` interpolation with the helper. Keep the detailed `sendAdminLog` calls untouched for ops.
3. **Request board:** verify every transition (claim/complete/close/rate) calls `refreshRequestMessage` so buttons/labels always match status (Phase 1/2 make the state authoritative; this ensures the visual follows). Friendly confirmation copy per action.
4. **Rating UX:** on an already-rated message, show a friendly "Bạn đã đánh giá rồi." instead of a raw throw (pairs with Phase 1 guard).
5. **Giveaway embed:** add a clear ENDED/CANCELLED visual state (color + footer), and after reroll (replace semantics, Phase 2) show the current winner set cleanly, not appended.
6. **Star game copy:** friendly, localized messages for cooldown remaining, area tool-level lock, empty bag, insufficient Scoin.
7. **Music panel:** clear feedback for "bạn cần vào voice", "không có bài đang phát" instead of raw errors; ensure control buttons reflect player state.
8. **Consistency pass:** ensure emoji + tone consistent (config.ui.emojis) across all new copy.

## Todo List

- [ ] `userFacingError.ts` created and used in interaction handlers
- [ ] New i18n keys added
- [ ] Request board buttons always reflect status
- [ ] Re-rate shows friendly message
- [ ] Giveaway end/cancel/reroll embed states clear
- [ ] Star game friendly copy
- [ ] Music panel friendly feedback
- [ ] `npm run build` clean

## Success Criteria

- [ ] No raw internal error string (e.g. "Not enough Scoin.") is shown to end users; friendly localized copy appears instead.
- [ ] Admin log still contains the raw error detail for ops.
- [ ] Every request/giveaway state transition updates the message so buttons/labels match the true status.
- [ ] Manual walkthrough of each flow (request, giveaway, star, music) shows consistent tone and correct button states.

## Risk Assessment

- **Risk:** centralizing error copy accidentally swallows a message an admin relied on. **Mitigation:** admin log keeps raw detail; only the user-facing reply is mapped.
- **Risk:** UX changes depend on Phase 1-3 correctness; running before them shows misleading states. **Mitigation:** dependency declared; run after.

## Next Steps

Run after Phases 1-3. Feeds Phase 7 verification (manual UX walkthrough).
