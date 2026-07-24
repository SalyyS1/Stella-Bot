---
phase: 3
title: "Forum board, tags, skill-role match-ping"
status: pending
priority: P1
effort: "2-3d"
dependencies: [2]
---

# Phase 3: Forum board, tags, skill-role match-ping

## Overview

The core fix for the real complaint ("đăng nhưng không khớp / ít người chú ý"). Make requests filterable by skill/budget/type and actively route each new request to freelancers who opted into that skill via role-ping. Highest impact-to-effort item in the whole plan.

## Requirements

- Functional:
  1. Requests carry structured **tags** (skill: design/dev/video/writing/other; type: PAID/FREE; budget band).
  2. Freelancers self-assign **skill roles** via a reaction/button role menu.
  3. On new request, bot pings the matching skill role(s) once, in the request channel, with `allowedMentions` scoped to that role only.
- Non-functional: no duplicate pings on edit/refresh; ping only on create; respect existing single-guild `config.ts` model (add new IDs there).

## Architecture

- **Route decided = B (keep text channels + structured skill).** Route A (migrate `requestFree`/`requestPaid` to Forum channels) is DROPPED, not "confirm later": for a 50-300 server there are too few concurrent posts for native tag-filtering UI to matter, and the showcase system already implements Forum `availableTags`/`appliedTags` (`showcaseManager.ts:291,307`) if that pattern is ever wanted. Commit to B; do not rebuild forum logic here.
- **Skill = closed enum on the EXISTING `service` field — no new column.** `RequestPost.service` (schema.prisma:260) and `budget` already exist and are already captured in the request modals. Do NOT add `skill`/`budgetBand` columns (duplicate data, needless migration, null backlog rows). Instead convert the free-text `service` modal input into a **fixed string-select** (`design | dev | video | writing | other`) writing to the existing `service` column. Only NEW work is the enum→role-ID mapping.
- **Skill roles (must be built, NOT reused — there is no ready-time bootstrap):** `ready.ts:10-17` creates zero roles; `updateLevelRole` (xpManager.ts:119) only runs lazily on level-up and matches by name. So add a real `ClientReady` reconciliation that creates missing skill roles and PERSISTS their IDs (config.ts is a static file — write IDs to `ManagedChannel` key→id store, not back to source). Add `config.roles.skills` catalog of the fixed enum keys.
- **Match-ping (resolve by persisted ID, never by user text):** the skill enum value maps to `config.roles.skills.<key>` → the persisted role ID. Ping with `allowedMentions: { roles: [resolvedId] }` following the safe fixed-ID pattern already used at `giveawayManager.ts:189` (`{ roles: [options.pingRoleId] }`). Before pinging, assert the resolved ID is non-empty AND not equal to the guild ID (guild ID = `@everyone` → mass-ping / anti-raid trip). Ping ONLY on create.
- **Backfill:** existing OPEN/CLAIMED requests predate the enum; the migration path must default their `service` to `other` (or leave as-is and null-guard every consumer). State explicitly: pre-existing requests are NOT re-pinged (ping is create-only by design).
- **Schema:** NO migration needed for skill (reuses `service`). Only `ManagedChannel` rows for persisted role IDs, which already exists as a model.

## Related Code Files

- Modify: `src/config.ts` (roles.skills catalog — enum keys only, IDs persisted at runtime not here), `src/systems/requestManager.ts` (`createCommunityRequest` at :111 — accept skill, match-ping after send), `src/events/ready.ts` (NEW skill-role reconciliation on ClientReady), `src/events/interactionCreate.ts` (modal DEFINITIONS `requestpaid_modal`/`requestfree_modal` at :383-397, and the `createCommunityRequest` caller at :65 — this is the real modal site, NOT `request.ts`), `src/events/messageCreate.ts` (SECOND creation entry point at :190,216 — text-form path also needs the skill field).
- **Do NOT modify `src/commands/request.ts`** — it is only `/request list` (read-only, no modal, never calls `createCommunityRequest`). The earlier draft targeting it was wrong (verified: grep `createCommunityRequest` in request.ts = 0 matches).
- Create: `src/commands/skills.ts` OR a select-menu button — self-serve skill-role toggle (choose one, don't build both). Note `panel.ts` has only static buttons (`panel_paid/free/port/serverads` at :42-46); a skill-role menu is NET-NEW UI, not a panel extension.
- Reference: `giveawayManager.ts:189` for the safe fixed-role-ID `allowedMentions` pattern. NOTE: there is NO reusable role-bootstrap in `xpManager.ts`/`ready.ts` — `updateLevelRole` is lazy/level-up-triggered/name-matched; the ready-time skill-role creation is new code (follow the create-by-name idiom, but write the startup pass yourself).

## Implementation Steps

1. Route is DECIDED = B (no user reconfirm; route A dropped per red-team).
2. NO skill migration — reuse existing `service` column; convert its modal input to a fixed string-select enum (`design|dev|video|writing|other`).
3. `config.ts`: add `roles.skills` enum catalog. Add a `ClientReady` pass in `ready.ts` that creates any missing skill role and PERSISTS its ID to `ManagedChannel` (config is static — never write IDs back to source).
4. Add the skill string-select to BOTH creation entry points: the modals in `interactionCreate.ts` AND the text-form path in `messageCreate.ts`; pass skill through to `createCommunityRequest`.
5. In `createCommunityRequest` after message send: resolve skill enum → persisted role ID; assert ID non-empty AND != guildId; ping with `allowedMentions: { roles: [roleId] }`. Ping ONLY on create.
6. Backfill: default existing OPEN/CLAIMED `service` rows to `other` (or null-guard consumers); document that pre-existing requests are not re-pinged.
7. Skill-role self-serve menu (net-new select-menu button or `/skills`).

## Success Criteria

- [x] New request records a skill (fixed enum on `service`) and pings exactly the matching skill role, once.
- [x] Skill input is a closed string-select — no free text can resolve to an arbitrary/privileged role.
- [x] Resolved ping role ID is asserted non-empty AND != guild ID before pinging (no `@everyone` mass-ping).
- [x] Skill roles are created + IDs persisted at `ClientReady` (not dependent on a level-up).
- [x] A user can add/remove their skill roles without admin help.
- [x] No ping fires on request edit/refresh/claim.
- [x] Pre-existing OPEN/CLAIMED requests are handled (defaulted to `other` or null-guarded); documented that they are not re-pinged.
- [x] No new DB column added for skill (reuses `service`).
- [x] `npm run build` clean.

## Risk Assessment

- **Ping fatigue (MED):** one ping per request, scoped role only; users opt in. Consider a per-role mute note.
- **Empty/unset role ID (MED):** config IDs start empty and there is no level-up trigger for skill roles — the `ClientReady` reconciliation MUST create + persist them, else match-ping resolves to `""` and no-ops (or throws). Guard for non-empty ID before pinging.
- **Free-text → role injection (MED → mitigated):** skill is a closed enum mapped to a fixed persisted ID, never a name lookup on user input; assert resolved ID != guild ID.
- **Backlog not re-pinged (LOW, accepted):** ping is create-only; existing open requests won't get a match-ping. Acceptable — they can be reposted if needed.
- **Role ID drift (LOW):** IDs persisted to `ManagedChannel` at runtime; document the reconciliation step.
