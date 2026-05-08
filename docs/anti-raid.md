# Stella Anti-Raid Notes

## Setup required

- Put Stella's role above every bot/member role that Stella should be able to stop.
- Give Stella: View Audit Log, Manage Messages, Manage Channels, Manage Roles, Kick Members, Ban Members, Moderate Members, Manage Webhooks.
- Keep only one live Stella instance running.

Discord bots cannot prevent an action before Discord accepts it. Stella detects the audit log event, removes/rolls back what it can, then punishes the actor if role hierarchy allows it.

## Covered threats

- Everyone/here ping spam: delete message immediately, strike actor, punish at threshold.
- Mass channel create: strike actor, delete created channel after threshold.
- Channel delete: recreate text/category channels with same name/basic settings, strike actor.
- Channel rename/topic edit: rollback name/topic, strike actor.
- Member kick/ban waves: detect via audit log, strike actor.
- Role create/delete/update: detect, rollback role edits where possible, strike actor.
- Webhook creation: detect and strike actor.
- Stella bot self-pings: disabled globally with `allowedMentions` so Stella cannot ping `@everyone/@here`.

## Important remaining risks

- If an attacker has a role above Stella, Stella can log but cannot ban/kick/timeout them.
- Deleted channel message history cannot be restored by any normal Discord bot.
- Deleted roles cannot be fully restored with member assignments unless a role snapshot system is added later.
- Permission overwrite edits are partly covered by channel update detection, but a full overwrite rollback snapshot would be stronger.
- Mass nickname changes, mass thread creation, invite spam, emoji/sticker deletion, guild rename/icon changes, integration/webhook abuse, and permission escalation should be added if they become real attack paths.
