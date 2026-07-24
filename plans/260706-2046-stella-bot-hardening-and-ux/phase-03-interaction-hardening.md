---
phase: 3
title: "Interaction Hardening"
status: completed
priority: P1
dependencies: [2]
---

# Phase 3: Interaction Hardening

## Overview

Bring the request/announce/music button branches and the modal-submit create paths up to the same defer + `.catch` hardening the giveaway branch already has. Eliminate token-expiry (10062) failures, unhandled rejections from un-awaited `return interaction.reply(...)`, and the empty-form crash that orphans a request row.

## Key Insight

The giveaway button branch (interactionCreate.ts:197-231) is the correct template: `safeDeferEphemeral` first, then `editReply(...).catch(() => {})`. The request branch (267-306) and the modal-submit create paths were never updated, so slow DB + `refreshRequestMessage` (channel fetch + message fetch + edit) work blows past the 3s window before the first ack.

## Requirements

- Functional: every button/modal handler acks within 3s and never throws to `unhandledRejection`; no DB row is created without a corresponding user-visible outcome.
- Non-functional: consistent error UX (`config.ui.emojis.error` + concise Vietnamese message).

## Related Code Files

- Modify: `src/events/interactionCreate.ts` (request branch 267-306; announce 134-159; music 161-170; modal-submit create paths 415-552)
- Modify: `src/events/messageCreate.ts` (empty-form validation 166-214; dead portfolio block 216-247; levelUp cleanup)
- Modify: `src/systems/requestManager.ts` (guard empty `service`/`description` in `createCommunityRequest`)

## Implementation Steps

1. **Request branch defer + catch (interactionCreate.ts:267-306):** call `await safeDeferEphemeral(interaction)` at branch entry (bail if it returns false). Convert `claim`/`complete`/`close` `interaction.reply(...)` → `interaction.editReply(...).catch(() => {})`. For `rate`, keep the message update but route through a safe wrapper: after `rateRequest`, `interaction.update(...)` may fail if the token expired — wrap in `.catch(() => interaction.editReply(...))`. Note: the `rate` no-op-guard itself is Phase 1 (C1); this step only hardens the response.
2. **Un-awaited returns (interactionCreate.ts:139,151,157,166,168,275,285,295,300,303):** change `return interaction.reply(...)` / `return interaction.update(...)` to `return await ...catch(() => {})` (or route through `safeInteractionReply`) so rejections are caught by the surrounding `try`.
3. **Empty-form crash (messageCreate.ts:166-214 + requestManager.ts:98-118):** current validation checks `content.includes('[Service]')` (presence, not non-empty). A field like `[Service]\n` passes but yields `''`, which throws in `addFields` (discord.js requires value length ≥ 1). Fix at both layers:
   - In `messageCreate.ts`, reject when any required part is empty after trim, warn the user (ephemeral or short auto-deleted reply), and do **not** delete their original message until validation passes.
   - In `createCommunityRequest`, defensively coerce empty `service`/`description`/`budget` to a placeholder (e.g. `'Chưa ghi'`) so the embed never throws even if a caller slips through.
   - Wrap the `createCommunityRequest` call site in try/catch; on failure, warn the user and ensure no orphan row (the row is created before the embed send — either build the embed before insert, or delete the row on send failure).
4. **Modal-submit create paths (interactionCreate.ts:415-552):** the request/portfolio modal handlers reply without a defer and without try/catch. `createCommunityRequest` does multiple network calls (channel send, DB update, admin log). Add `await interaction.deferReply({ flags: Ephemeral })` at the top of each create handler and switch to `editReply`, mirroring the serverads (484) and giveaway (515) handlers that already defer. Wrap bodies in try/catch that `editReply`s a concise error.
5. **Giveaway modal create try/catch (interactionCreate.ts:514-552):** `parseDuration` and `createGiveaway` can throw (bad duration, missing perms) after the defer, leaving a hanging ephemeral. Wrap the body in try/catch → `editReply` error.
6. **Dead portfolio text-form (messageCreate.ts:216-247):** the `else if ([portfolio, botLog].includes(...))` at 216 shadows the later `else if (channelId === portfolio)` at 226, making the text→embed transform unreachable. Portfolio posting works via `portfolio_modal` (panel button), so **delete** the dead block 226-247. (Confirmed panel path exists at interactionCreate.ts:328-337.)
7. **levelUp cleanup regression (messageCreate.ts:216):** the diff removed `levelUp` from the auto-delete channel list. Per unresolved question — if level-up is announce-only, restore it to the delete list; if user chat is now allowed there, leave as-is and note it. Default: restore (safer, matches prior behavior) unless user says otherwise.

## Todo List

- [ ] Request branch: defer + editReply + catch
- [ ] All un-awaited `return reply/update` → awaited + catch
- [ ] Empty-form validation (messageCreate + createCommunityRequest guard + no orphan row)
- [ ] Modal create paths defer + try/catch (request, portfolio)
- [ ] Giveaway modal create try/catch
- [ ] Delete dead portfolio text-form block
- [ ] levelUp cleanup decision applied
- [ ] `npm run build` clean

## Success Criteria

- [ ] Clicking "Nhận job" under DB latency never yields "This interaction failed" or an unhandled rejection; user sees an ephemeral result.
- [ ] Posting a request form with an empty `[Service]` value warns the user and creates no orphan DB row.
- [ ] A giveaway-create modal with an invalid duration shows an error instead of a hanging "thinking…".
- [ ] No unhandled rejection logs from interaction handlers during a manual smoke test.

## Risk Assessment

- **Risk:** switching modal replies to deferred changes the UX (ephemeral "thinking" flash). **Mitigation:** acceptable and consistent with existing serverads/giveaway handlers.
- **Risk:** deleting the portfolio block removes a feature if it was secretly in use. **Mitigation:** verified it is unreachable dead code; panel modal is the supported path.

## Security Considerations

Un-acked interactions and orphan rows are reliability issues; no new authz surface introduced. Existing authz checks (author/admin gates) are preserved.
