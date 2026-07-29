'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = relative => fs.readFileSync(path.join(root, 'src', relative), 'utf8');

const interaction = source('events/interactionCreate.ts');
const panel = source('commands/panel.ts');
const ads = source('systems/serverAdsManager.ts');
const message = source('events/messageCreate.ts');
const game = source('commands/game.ts');
const scoin = source('systems/scoinManager.ts');
const daily = source('commands/daily.ts');
const xp = source('systems/xpManager.ts');
const giveaway = source('systems/giveawayManager.ts');
const antiRaid = source('systems/antiRaidManager.ts');
const showcase = source('systems/showcaseManager.ts');
const vote = source('systems/voteManager.ts');
const maintenance = source('commands/maintenance.ts');
const music = source('systems/musicManager.ts');
const backfill = source('systems/voteBackfillManager.ts');
const requests = source('systems/requestManager.ts');
const events = source('handlers/eventHandler.ts');
const pluginParser = source('systems/builder/plugin-source-file-parser.ts');
const pluginCmd = source('commands/plugin-source.ts');
const buildClient = source('systems/builder/plugin-build-client.ts');
const chunkCollector = source('systems/report/report-chunk-collector.ts');
const scheduler = source('systems/report/report-scheduler.ts');
const imageCollector = source('systems/report/report-image-collector.ts');
const chunkStore = source('systems/report/report-chunk-store.ts');
const config_ts = source('config.ts');
const buildWorkflow = fs.readFileSync(
    path.join(root, '.github', 'workflows', 'build-plugin.yml'),
    'utf8'
);
const dbUtils = fs.readFileSync(path.join(root, 'scripts', 'db-utils.js'), 'utf8');
const backup = fs.readFileSync(path.join(root, 'scripts', 'backup-db.js'), 'utf8');
const restore = fs.readFileSync(path.join(root, 'scripts', 'restore-db.js'), 'utf8');
const sqliteImport = fs.readFileSync(path.join(root, 'scripts', 'import-sqlite-to-postgres.js'), 'utf8');

assert(interaction.includes("cmdName !== 'panel'"), 'panel restricted-channel exception missing');
assert(panel.includes("setName('channel')") && panel.includes('PermissionFlagsBits.EmbedLinks'), 'panel target/permission checks missing');
assert(!ads.includes('directMinecraftStatus'), 'direct Minecraft status SSRF fallback remains');
assert(message.includes('if (await guardEveryoneMention(message)) return;'), 'anti-raid message fallthrough remains');
assert(showcase.includes('allowedMentions: { users: [post.authorId]'), 'showcase mention allowlist missing');
assert(vote.indexOf('await lockVoteScores(tx)') < vote.indexOf('const existing = await tx.vote.findUnique'), 'vote snapshot is read before lock');
assert(game.indexOf('settleScoinWager(') < game.indexOf("const frames = ['Đồng xu"), 'coinflip settles after animation');
assert(game.includes("from 'crypto'") && giveaway.includes("from 'crypto'"), 'secure random source missing');
assert(scoin.includes('scoinBalance: { gte: -amount }') && scoin.includes('scoinBalance: { gte: bet }'), 'atomic Scoin debit missing');
assert(daily.includes('Lock this user') && daily.includes('adjustScoinTx(tx'), 'atomic daily claim missing');
assert(xp.includes('levelScoinReward(newLevel)') && !message.includes('await adjustScoin(message.author.id'), 'level reward is not atomic');
assert(giveaway.includes('MAX_GIVEAWAY_DURATION_MS') && giveaway.includes('prisma.giveaway.delete'), 'giveaway bounds/rollback missing');
assert(antiRaid.includes("markInternalAntiRaidAction('roleUpdate'") && antiRaid.includes('count: current'), 'anti-raid internal action accounting missing');
assert(maintenance.includes("setName('status')"), 'maintenance status command missing');
assert(music.match(/existingPlayer\.voiceChannelId !== member!/g)?.length === 2, 'music queue channel isolation missing');
assert(backfill.includes('tx.requestReview.groupBy') && backfill.includes('requestRatings'), 'request rating score preservation missing');
assert(requests.includes('await lockVoteScores(tx)'), 'request rating/backfill serialization missing');
assert(events.includes('Promise.resolve(event.execute'), 'async event rejection boundary missing');
assert(backfill.includes('votes += result.synced') && !backfill.includes('const votes = await prisma.vote.count()'), 'vote backfill reports total rows instead of mutations');
assert(antiRaid.includes('AuditLogEvent.WebhookUpdate') && antiRaid.includes('AuditLogEvent.WebhookDelete'), 'webhook audit attribution is create-only');
assert(antiRaid.includes('isConsumedWebhookAuditEntry') && antiRaid.includes('WEBHOOK_AUDIT_RETRY_DELAYS_MS') && antiRaid.includes('fetchRecentAudits(channel.guild!, action.type, 100)'), 'webhook audit entries can be reused or missed during propagation');
assert(antiRaid.includes("return attempted ? 'punishment-failed' : 'no-permission'"), 'anti-raid punishment can claim false success');
assert(backup.includes("isolationLevel: 'RepeatableRead'"), 'backup is not a repeatable-read snapshot');
assert(restore.includes('await clearExistingData(tx)') && restore.includes('await resetSequences(tx)'), 'restore is not atomic');
assert(sqliteImport.includes('return result.count'), 'SQLite import reports attempted rows');
for (const model of ['GuildSettings', 'StarItemStack', 'RequestPost', 'RequestClaim', 'RequestReview']) {
    assert(dbUtils.includes(`name: '${model}'`), `backup table ${model} missing`);
}
assert(!fs.readFileSync(path.join(root, 'package.json'), 'utf8').includes('minecraft-server-util'), 'removed SSRF dependency remains');

// Kotlin must be RECOGNISED and then refused, never merely unmatched. The runner
// compiles Java only, so a .kt file that slips through is copied in, never
// compiled, and Gradle still succeeds — a jar missing code under the studio's
// name. Dropping .kt from NAME_LINE would make it invisible instead of skipped,
// which is what re-opens that hole.
assert(/NAME_LINE\s*=.*\bkt\b/.test(pluginParser), 'parser no longer recognises .kt, so a Kotlin file becomes invisible instead of skipped');
assert(!/ALLOWED\s*=.*\bkt\b/.test(pluginParser), 'parser accepts .kt, which the Java-only runner cannot compile');
assert(pluginParser.includes('không phải Java'), 'parser does not tell the member why a .kt file was dropped');
assert(pluginCmd.includes('parsed.skipped.length === 0'), 'build gate ignores dropped files, so a jar can ship missing code');
assert(/\\\.kt\$\/i\.test\(base\)/.test(buildWorkflow) && buildWorkflow.includes('process.exit(1)'), 'runner does not fail hard on Kotlin source');
assert(!buildWorkflow.includes("-name '*.kt'"), 'runner still copies .kt into a Java-only Gradle project');

// A poll that fails after the run was located must not downgrade it to
// run-not-found: that loses the log URL the member needs to see why a build died.
assert(buildClient.includes('if (found) run = found;'), 'a transient poll failure discards an already-located run');
// GitHub's 65,535-char cap on a workflow_dispatch input surfaces as a bare 422,
// indistinguishable from a bad ref, so it has to be caught before dispatching.
assert(buildClient.includes("reason: 'payload-too-big'"), 'oversized payload is left for GitHub to reject opaquely');

// An empty window may only be recorded when the walk proved it empty. Storing an
// unproven one stamps a busy evening as quiet, permanently.
assert(chunkCollector.includes('reachedStart') && scheduler.includes('if (!chat.reachedStart)'), 'quiet-window proof is gone, so an out-of-budget walk can be stored as empty');
// MaintenanceLog is shared: pruning it unscoped would delete other systems' locks.
assert(chunkStore.includes("kind: { in: ['report-chunk', 'report'] }"), 'chunk-claim pruning is not scoped to the report kinds');
// The gateway fetches image URLs itself, so Discord's signed query must survive.
assert(imageCollector.includes('image_url: { url: attachment.url }'), 'image URL is rewritten, which strips the Discord CDN signature');

// The daily post window is one hour wide, but chunk+backfill in a single tick can
// now run ~30 minutes (three AI calls at a 10-minute ceiling each). Reading the
// clock AFTER that work means a tick starting at 21:45 checks at 22:15 and drops
// the whole day's bulletin, after paying for every chunk. The hour must be
// sampled before the slow work, and the decision kept in a variable.
assert(
    scheduler.indexOf('const dueForDaily') < scheduler.indexOf('await runChunk(client)'),
    'tick samples the hour after chunk work, so a slow run can miss the daily post window entirely'
);
// The admin path must rebuild missing windows before reducing, or `/maintenance
// report` just folds whatever happens to be in the DB — which on the first day is
// nothing, and the admin pressed the command precisely to review the last 24h.
assert(
    scheduler.includes('backfillAllSlots') && scheduler.includes('if (force)'),
    'admin report no longer rebuilds missing windows, so it cannot actually review the last 24h'
);
// Budgets must stay under the gateway ceiling measured on 2026-07-29 (128k):
// exceeding it is an HTTP 400 that loses the window outright, not a smaller reply.
assert(
    config_ts.includes('maxTokens: 40_000') && config_ts.includes('maxTokens: 60_000'),
    'report budgets moved; re-probe the gateway ceiling before raising them'
);

// The scheduler runs unattended on a 15-minute beat. With logging only on the
// error path, "healthy" and "dead" produce the same empty log, and the first
// symptom is a missing bulletin at 21h — i.e. after the day is already lost. The
// heartbeat line is what makes silence itself diagnostic, so it has to survive:
// an open/close pair per tick distinguishes a slow tick from one hung mid-step.
assert(
    scheduler.includes('tick #${tickCount}: đang sống'),
    'per-tick heartbeat log is gone, so a dead scheduler looks identical to an idle one'
);
assert(
    scheduler.includes('tick #${tickCount}: xong sau'),
    'tick completion log is gone, so a tick hung mid-step cannot be told from a slow one'
);
assert(
    scheduler.includes('lượt trước còn đang chạy'),
    'skipped-tick log is gone, so a hung run silently swallows every later beat'
);
assert(
    scheduler.includes('scheduler bật:'),
    'startup log is gone, so a disabled config looks the same as code that never ran'
);

console.log('Stella self-check passed (51 assertions).');
