---
phase: 3
title: "Wiki knowledge store and add-wiki command"
status: pending
priority: P2
effort: "1d"
dependencies: [1]
---

# Phase 3: Wiki knowledge store and add-wiki command

## Overview
A DB-backed catalog of plugin wiki links the AI can consult when answering plugin questions. Seeded with popular plugins on startup; admins (role higher than the bot) extend it via `/add wiki`. Q&A (Phase 4) reads this catalog to decide which link to fetch.

## Requirements
- Functional:
  1. `WikiEntry` table: `name` (unique key, lowercased), `url`, `aliases` (optional CSV), `addedBy`, timestamps.
  2. Seed popular plugins on `ClientReady` if absent (idempotent create-if-missing).
  3. `/add wiki <name> <url>` — admin-gated (permission-based, see below); validates URL; upserts.
  4. A `listWikiEntries()` / `findWikiEntry(query)` helper for Phase 4.
- Non-functional: URL validated (http/https only) to avoid storing junk; admin check fail-closed.

## Architecture
- **Schema:** new `WikiEntry` model (`name @id` lowercased, `url`, `aliases String?`, `addedBy String`, `createdAt`, `updatedAt`). Additive migration (`db:push`).
- **Seed list (config):** `config.ai.seedWikis` — MythicMobs, MMOItems, MMOCore, ModelEngine, MythicCrucible, DeluxeMenus, PlaceholderAPI, Vault, LuckPerms, Citizens, WorldGuard, etc. Each `{ name, url, aliases }`. Bot upserts missing ones on ready (create-if-absent, never overwrite an admin edit).
- **New module:** `src/systems/wikiManager.ts` (<200 lines): `seedWikis()`, `addWiki(name, url, actorId)`, `findWikiEntry(query)` (match name or alias, case-insensitive), `listWikiEntries()`.
- **Admin authz — "role higher than bot":** the user said admins = role higher than the bot. Two options: (a) `Administrator` permission (simple, matches every other admin command in this repo — `panel.ts:11`, `maintenance.ts`), or (b) compare `member.roles.highest.position > bot.member.roles.highest.position`. Decision: use **`Administrator`** for consistency with existing commands (KISS); note the "higher than bot" phrasing in the command description. Confirm at cook if the user insists on positional check.
- **Command:** `/add` with subcommand `wiki` (`name`, `url` string options). New file `src/commands/add.ts` (commandHandler auto-loads).

## Related Code Files
- Create: `src/systems/wikiManager.ts`, `src/commands/add.ts`.
- Modify: `prisma/schema.prisma` (WikiEntry), `src/config.ts` (`ai.seedWikis`), `src/events/ready.ts` (call `seedWikis()` once).
- Reference: `panel.ts:11` (Administrator gate idiom), `skillRoleManager.ts` (create-if-missing seed pattern on ready).

## Implementation Steps
1. Add `WikiEntry` model; `db:push` (user runs against Supabase).
2. `config.ai.seedWikis` list of popular plugins with official wiki URLs.
3. `wikiManager.ts`: seed (create-if-absent), add (validate URL, upsert), find (name/alias), list.
4. `/add wiki` command, Administrator-gated, validates `http(s)://` URL, calls `addWiki`.
5. Call `seedWikis()` in `ready.ts` (guarded, non-fatal on error).
6. `npm run build`.

## Success Criteria
- [ ] Seed plugins exist in DB after first ready (idempotent — re-run doesn't duplicate or overwrite edits).
- [ ] `/add wiki` rejects non-admins and invalid URLs; adds valid ones.
- [ ] `findWikiEntry("mmoitems")` resolves by name and by alias.
- [ ] `npm run build` clean.

## Risk Assessment
- **Wiki URL rot (LOW):** links may change; admins fix via `/add wiki` (upsert overwrites).
- **SSRF via arbitrary URL (MED):** Phase 4 fetches these URLs — restrict `/add wiki` to admins + http(s) only; document that only trusted admins add links. Actual fetch hardening lives in Phase 4.
- **Seed overwrites admin edit (LOW → mitigated):** seed is create-if-absent only, never updates an existing row.
