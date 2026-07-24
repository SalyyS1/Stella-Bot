---
phase: 4
title: "Security"
status: completed
priority: P1
dependencies: []
---

# Phase 4: Security

<!-- Updated: Validation Session 1 - confirmed fail-closed password, http:false default, same-voice-channel authz (all recommended options accepted) -->

## Overview

Close the Lavalink hosting exposures: the committed default password with `0.0.0.0` bind (open relay on a forgot-to-set-env deploy), SSRF via the enabled `http` source, and the missing same-voice-channel authorization on playback controls. Independent of the economy/state work — can run in parallel.

## Key Insight

`lavalink-host/application.yml` ships in the host package (`scripts/prepare-host-package.js`). The `${VAR:default}` syntax means a missing env var silently falls back to the repo-public password `change_me_lavalink_password`, bound on all interfaces. Any user can `s!stop`/`/music stop` another room's music because `controlMusic` only checks a player exists.

## Requirements

- Functional: Lavalink fails closed (no boot) when the password env is unset; playback controls require the caller to share the bot's voice channel.
- Non-functional: no secret defaults in version control; host package remains deployable with documented env vars.

## Related Code Files

- Modify: `lavalink-host/application.yml` (password fallback line 13; bind address line 3; `http` source line 20)
- Modify: `src/systems/musicManager.ts` (`controlMusic` authz ~248; health panel infra disclosure 131-152; `ensureVoice` perms 30-32)
- Modify: `docs/lavalink-bot-hosting.md` / `docs/music-setup.md` (document required env)

## Implementation Steps

1. **Fail-closed password (application.yml:13):** change `password: "${LAVALINK_SERVER_PASSWORD:change_me_lavalink_password}"` → `password: "${LAVALINK_SERVER_PASSWORD}"`. Document in `.env.example` and the hosting docs that this MUST be set. Confirm `musicManager.ts` node config reads the same var so bot↔node auth still matches.
2. **Bind address (application.yml:3):** if bot and Lavalink share a host (unresolved question — default assume co-located for the Pterodactyl package), set `address: 127.0.0.1`. If a separate public node is intended, keep `0.0.0.0` but document that a strong password + firewall is mandatory. Gate the choice on the user's answer; default to `127.0.0.1`.
3. **SSRF via http source (application.yml:20 + musicManager.ts:206,239):** set `http: false` unless direct-URL streaming is a deliberate feature. If it must stay enabled, add a private/link-local IP denylist before passing user URLs to `player.search` (block `169.254.0.0/16`, `10/8`, `172.16/12`, `192.168/16`, `127/8`, `::1`, metadata hostnames). Default: disable `http`.
4. **Playback-control authz (musicManager.ts:248 `controlMusic`, callers 337/373):** before stop/skip/shuffle/pause, verify `member.voice.channelId === player.voiceChannelId`. Reject with a clear ephemeral message otherwise. Thread the acting member/voice state into `controlMusic` (currently it only takes client/guildId/type — extend the signature or pass the member).
5. **Health panel disclosure (musicManager.ts:131-152, callers 333/371):** gate `s!health` / `/music health` node `host:port` output behind admin/manage-guild, or drop host:port from the public embed. Default: keep the command public but redact host:port for non-admins.
6. **ensureVoice bot perms (musicManager.ts:30-32):** check the bot has Connect/Speak in the target channel before `player.connect()`; return a clear "tôi không có quyền vào voice" message instead of an opaque caught error.

## Todo List

- [ ] Password fails closed; env documented
- [ ] Bind address decision applied
- [ ] `http` source disabled (or IP denylist)
- [ ] controlMusic same-voice-channel authz
- [ ] Health panel host:port gated/redacted
- [ ] ensureVoice bot-perms check
- [ ] `npm run build` clean

## Success Criteria

- [ ] Starting Lavalink without `LAVALINK_SERVER_PASSWORD` set refuses to boot (or logs a hard error), never boots with a default password.
- [ ] A user not in the bot's voice channel cannot stop/skip playback.
- [ ] `grep -r change_me_lavalink_password` returns no matches in shipped config.
- [ ] `s!play http://169.254.169.254/...` does not cause the host to fetch internal URLs.

## Risk Assessment

- **Risk:** fail-closed password breaks existing deploys that relied on the default. **Mitigation:** documented breaking change; surfaced in verification + hosting docs. This is the intended security posture.
- **Risk:** `127.0.0.1` bind breaks a separate-node deployment. **Mitigation:** gated on the co-location question; documented both modes.

## Security Considerations

This phase is the security core: eliminates a public open-relay vector, an SSRF pivot into internal/cloud-metadata networks, and a griefing vector on shared playback. All changes fail safe.
