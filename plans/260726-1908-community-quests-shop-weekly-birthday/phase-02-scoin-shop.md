---
name: phase-02-scoin-shop
status: pending
created: 2026-07-26T12:17:53Z
updated: 2026-07-26T12:17:53Z
---

# Phase 02 — Scoin Shop (role màu tên)

## Files to CREATE (own ONLY these; do NOT edit any other file)
- `src/systems/shop-manager.ts`
- `src/commands/shop.ts`

## Read first (context)
- `prisma/schema.prisma` → `ShopColorRole`, `ShopPurchase`
- `src/config.ts` → `config.shop` (enabled, colorRolePrice, colors[{key,label,hex}]), `config.ui.emojis`
- `src/systems/scoinManager.ts` → `adjustScoin`, `getScoinBalance`
- `src/systems/skillRoleManager.ts` → house pattern: ensure/reuse role by DB id, member role add/remove
- `src/systems/antiRaidManager.ts` → `markInternalAntiRaidAction` — MUST call `markInternalAntiRaidAction('roleCreate', '*')` immediately before `guild.roles.create`, else anti-raid strikes the bot (CRITICAL self-action alert)

## Requirements

### shop-manager.ts
- `ensureColorRole(guild, colorKey)` — look up `ShopColorRole` by key; verify role still exists in guild (`guild.roles.fetch(roleId)`); if missing → mark internal allow then `guild.roles.create({ name: '🎨 ' + label, color: hex, permissions: [], mentionable: false, position: <bot's highest role position> })` (Discord clamps; position set ONLY at create — NEVER call `setPosition` afterwards: position-only updates would trip anti-raid roleUpdate guard); upsert `ShopColorRole`.
- `buyColorRole(guild, userId, colorKey): Promise<string>` (returns VN success text, throws Error with VN message on failure):
  1. Validate enabled + key + bot has `ManageRoles`.
  2. Fetch member; if member already has this color role → throw "đã sở hữu màu này".
  3. `ensureColorRole`.
  4. Debit FIRST: `adjustScoin(userId, -price, 'Mua màu tên: <label>', 'shop:color', key)` — throws 'Not enough Scoin.' when balance insufficient (map to VN message).
  5. Assign: remove any OTHER shop color roles the member has (from `ShopColorRole` table ∩ member roles), add the new role. If add fails → REFUND `adjustScoin(userId, +price, 'Hoàn tiền shop (gán role lỗi)', 'shop:refund', key)` and throw.
  6. `shopPurchase.create` for the audit trail.
- `listOwnedColorKey(member)` helper for display.

### commands/shop.ts
- `/shop xem` — deferReply ephemeral FIRST; embed: catalog (label + hex swatch text + price), số dư hiện tại (`getScoinBalance`), màu đang dùng nếu có.
- `/shop mua mau:<choice>` — choices generated statically from `config.shop.colors` (≤25, OK); deferReply ephemeral; call `buyColorRole`; success/error reply với emojis nhà.

## Success criteria
- Insufficient balance → clean VN error, NO role change, NO purchase row.
- Role-assign failure → refund recorded (`shop:refund` ledger row).
- Buying a second color swaps (old shop color removed).
- Bot never triggers its own anti-raid (internal allow before every roles.create; no setPosition).
- No edits outside owned files.
