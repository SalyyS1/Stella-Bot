'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Đếm số assertion đã chạy — đưa vào dòng kết luận để một block bị bỏ sót (source
// trả rỗng, file đổi tên...) hiện ra ngay thay vì lặng lẽ in "passed".
let assertionsRun = 0;
const check = (cond, message) => {
    assertionsRun++;
    assert(cond, message);
};

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
const glossaryAsker = source('systems/knowledge/glossary-question-asker.ts');
const chunkSummarizer = source('systems/report/report-chunk-summarizer.ts');
const dailyComposer = source('systems/report/report-daily-composer.ts');
const aiClient = source('systems/aiClient.ts');
const reminderHandler = source('systems/reminder/reminder-handler.ts');
const reminderScheduler = source('systems/reminder/reminder-scheduler.ts');
const reminderStore = source('systems/reminder/reminder-store.ts');
const reminderParser = source('systems/reminder/reminder-parser.ts');
const reminderVoice = source('systems/reminder/reminder-voice.ts');
const qaManager = source('systems/aiQaManager.ts');
const emojiPalette = source('systems/emoji-palette.ts');
const buildWorkflow = fs.readFileSync(
    path.join(root, '.github', 'workflows', 'build-plugin.yml'),
    'utf8'
);
const dbUtils = fs.readFileSync(path.join(root, 'scripts', 'db-utils.js'), 'utf8');
const backup = fs.readFileSync(path.join(root, 'scripts', 'backup-db.js'), 'utf8');
const restore = fs.readFileSync(path.join(root, 'scripts', 'restore-db.js'), 'utf8');
const sqliteImport = fs.readFileSync(path.join(root, 'scripts', 'import-sqlite-to-postgres.js'), 'utf8');

check(interaction.includes("cmdName !== 'panel'"), 'panel restricted-channel exception missing');
check(panel.includes("setName('channel')") && panel.includes('PermissionFlagsBits.EmbedLinks'), 'panel target/permission checks missing');
check(!ads.includes('directMinecraftStatus'), 'direct Minecraft status SSRF fallback remains');
check(message.includes('if (await guardEveryoneMention(message)) return;'), 'anti-raid message fallthrough remains');
check(showcase.includes('allowedMentions: { users: [post.authorId]'), 'showcase mention allowlist missing');
check(vote.indexOf('await lockVoteScores(tx)') < vote.indexOf('const existing = await tx.vote.findUnique'), 'vote snapshot is read before lock');
check(game.indexOf('settleScoinWager(') < game.indexOf("const frames = ['Đồng xu"), 'coinflip settles after animation');
check(game.includes("from 'crypto'") && giveaway.includes("from 'crypto'"), 'secure random source missing');
check(scoin.includes('scoinBalance: { gte: -amount }') && scoin.includes('scoinBalance: { gte: bet }'), 'atomic Scoin debit missing');
check(daily.includes('Lock this user') && daily.includes('adjustScoinTx(tx'), 'atomic daily claim missing');
check(xp.includes('levelScoinReward(newLevel)') && !message.includes('await adjustScoin(message.author.id'), 'level reward is not atomic');
check(giveaway.includes('MAX_GIVEAWAY_DURATION_MS') && giveaway.includes('prisma.giveaway.delete'), 'giveaway bounds/rollback missing');
check(antiRaid.includes("markInternalAntiRaidAction('roleUpdate'") && antiRaid.includes('count: current'), 'anti-raid internal action accounting missing');
check(maintenance.includes("setName('status')"), 'maintenance status command missing');
check(music.match(/existingPlayer\.voiceChannelId !== member!/g)?.length === 2, 'music queue channel isolation missing');
check(backfill.includes('tx.requestReview.groupBy') && backfill.includes('requestRatings'), 'request rating score preservation missing');
check(requests.includes('await lockVoteScores(tx)'), 'request rating/backfill serialization missing');
check(events.includes('Promise.resolve(event.execute'), 'async event rejection boundary missing');
check(backfill.includes('votes += result.synced') && !backfill.includes('const votes = await prisma.vote.count()'), 'vote backfill reports total rows instead of mutations');
check(antiRaid.includes('AuditLogEvent.WebhookUpdate') && antiRaid.includes('AuditLogEvent.WebhookDelete'), 'webhook audit attribution is create-only');
check(antiRaid.includes('isConsumedWebhookAuditEntry') && antiRaid.includes('WEBHOOK_AUDIT_RETRY_DELAYS_MS') && antiRaid.includes('fetchRecentAudits(channel.guild!, action.type, 100)'), 'webhook audit entries can be reused or missed during propagation');
check(antiRaid.includes("return attempted ? 'punishment-failed' : 'no-permission'"), 'anti-raid punishment can claim false success');
check(backup.includes("isolationLevel: 'RepeatableRead'"), 'backup is not a repeatable-read snapshot');
check(restore.includes('await clearExistingData(tx)') && restore.includes('await resetSequences(tx)'), 'restore is not atomic');
check(sqliteImport.includes('return result.count'), 'SQLite import reports attempted rows');
for (const model of ['GuildSettings', 'StarItemStack', 'RequestPost', 'RequestClaim', 'RequestReview']) {
    assert(dbUtils.includes(`name: '${model}'`), `backup table ${model} missing`);
}
check(!fs.readFileSync(path.join(root, 'package.json'), 'utf8').includes('minecraft-server-util'), 'removed SSRF dependency remains');

// Kotlin must be RECOGNISED and then refused, never merely unmatched. The runner
// compiles Java only, so a .kt file that slips through is copied in, never
// compiled, and Gradle still succeeds — a jar missing code under the studio's
// name. Dropping .kt from NAME_LINE would make it invisible instead of skipped,
// which is what re-opens that hole.
check(/NAME_LINE\s*=.*\bkt\b/.test(pluginParser), 'parser no longer recognises .kt, so a Kotlin file becomes invisible instead of skipped');
check(!/ALLOWED\s*=.*\bkt\b/.test(pluginParser), 'parser accepts .kt, which the Java-only runner cannot compile');
check(pluginParser.includes('không phải Java'), 'parser does not tell the member why a .kt file was dropped');
check(pluginCmd.includes('parsed.skipped.length === 0'), 'build gate ignores dropped files, so a jar can ship missing code');
check(/\\\.kt\$\/i\.test\(base\)/.test(buildWorkflow) && buildWorkflow.includes('process.exit(1)'), 'runner does not fail hard on Kotlin source');
check(!buildWorkflow.includes("-name '*.kt'"), 'runner still copies .kt into a Java-only Gradle project');

// A poll that fails after the run was located must not downgrade it to
// run-not-found: that loses the log URL the member needs to see why a build died.
check(buildClient.includes('if (found) run = found;'), 'a transient poll failure discards an already-located run');
// GitHub's 65,535-char cap on a workflow_dispatch input surfaces as a bare 422,
// indistinguishable from a bad ref, so it has to be caught before dispatching.
check(buildClient.includes("reason: 'payload-too-big'"), 'oversized payload is left for GitHub to reject opaquely');

// An empty window may only be recorded when the walk proved it empty. Storing an
// unproven one stamps a busy evening as quiet, permanently.
check(chunkCollector.includes('reachedStart') && scheduler.includes('if (!chat.reachedStart)'), 'quiet-window proof is gone, so an out-of-budget walk can be stored as empty');
// MaintenanceLog is shared: pruning it unscoped would delete other systems' locks.
check(chunkStore.includes("kind: { in: ['report-chunk', 'report', 'report-weekly'] }"), 'chunk-claim pruning is not scoped to the report kinds');
// The gateway fetches image URLs itself, so Discord's signed query must survive.
check(imageCollector.includes('image_url: { url: attachment.url }'), 'image URL is rewritten, which strips the Discord CDN signature');

// The daily post window is one hour wide, but chunk+backfill in a single tick can
// now run ~30 minutes (three AI calls at a 10-minute ceiling each). Reading the
// clock AFTER that work means a tick starting at 21:45 checks at 22:15 and drops
// the whole day's bulletin, after paying for every chunk. The hour must be
// sampled before the slow work, and the decision kept in a variable.
check(
    scheduler.indexOf('const dueForDaily') < scheduler.indexOf('await runChunk(client)'),
    'tick samples the hour after chunk work, so a slow run can miss the daily post window entirely'
);
// The admin path must rebuild missing windows before reducing, or `/maintenance
// report` just folds whatever happens to be in the DB — which on the first day is
// nothing, and the admin pressed the command precisely to review the last 24h.
check(
    scheduler.includes('backfillAllSlots') && scheduler.includes('if (force)'),
    'admin report no longer rebuilds missing windows, so it cannot actually review the last 24h'
);
// Every max_tokens budget must stay under the gateway ceiling measured on
// 2026-07-29 (128k). Exceeding it is an HTTP 400 that loses the whole call, not a
// shorter reply — so a budget raised past the ceiling fails LOUDER than one set
// too low, and does it at runtime on a real window rather than here.
//
// Checked as a number, not as a literal match on today's values: pinning the
// exact figures made this fire every time a budget was tuned, which trains people
// to edit the assertion instead of reading it. The ceiling is the invariant.
const GATEWAY_MAX_TOKENS = 128_000;
const tokenBudgets = [...config_ts.matchAll(/maxTokens:\s*([\d_]+)/g)]
    .map(m => Number(m[1].replace(/_/g, '')));
check(tokenBudgets.length > 0, 'no maxTokens budgets found in config.ts — pattern moved');
check(
    tokenBudgets.every(n => n <= GATEWAY_MAX_TOKENS),
    `a maxTokens budget exceeds the measured gateway ceiling (${GATEWAY_MAX_TOKENS}): ` +
    `${tokenBudgets.filter(n => n > GATEWAY_MAX_TOKENS).join(', ')} — re-probe before raising`
);

// The scheduler runs unattended on a 15-minute beat. With logging only on the
// error path, "healthy" and "dead" produce the same empty log, and the first
// symptom is a missing bulletin at 21h — i.e. after the day is already lost. The
// heartbeat line is what makes silence itself diagnostic, so it has to survive:
// an open/close pair per tick distinguishes a slow tick from one hung mid-step.
check(
    scheduler.includes('tick #${tickCount}: đang sống'),
    'per-tick heartbeat log is gone, so a dead scheduler looks identical to an idle one'
);
check(
    scheduler.includes('tick #${tickCount}: xong sau'),
    'tick completion log is gone, so a tick hung mid-step cannot be told from a slow one'
);
check(
    scheduler.includes('lượt trước còn đang chạy'),
    'skipped-tick log is gone, so a hung run silently swallows every later beat'
);
check(
    scheduler.includes('scheduler bật:'),
    'startup log is gone, so a disabled config looks the same as code that never ran'
);

// The glossary write gate is the anti-poisoning lock: a wrong definition is
// reused in EVERY later bulletin. It must read the role allowlist, never fall
// back to "any member", and must sit before any DB work.
check(
    glossaryAsker.includes('config.roles.knowledgeTeachers'),
    'glossary write gate no longer reads the teacher-role allowlist'
);
// Path 2 (ping/reply anywhere) is only safe because being addressed to the bot
// is REQUIRED. Without that check every "abc = xyz" line in every channel — including
// two members explaining things to each other — becomes a lesson Stella believes.
check(
    glossaryAsker.includes('isAddressedToBot') && glossaryAsker.includes('mentions.users.has(selfId)'),
    'glossary accepts lessons without being addressed to the bot, so any channel chatter can teach it'
);
// collectAnswer must run before the Q&A block: that block returns early, so a
// lesson typed in the Q&A channel would be swallowed as a question instead.
check(
    message.indexOf('collectAnswer(message)') < message.indexOf('handleAiQa(message)'),
    'glossary collection runs after Q&A, so a lesson in the Q&A channel is eaten as a question'
);
// The bulletin is meant to read as an account of the day (who fell out with whom,
// over what) rather than a status report. Both prompt tiers have to ask for names
// and specifics: the reduce step never sees the raw chat, so a chunk that says
// "lively discussion" leaves nothing to retell, permanently.
check(
    chunkSummarizer.includes('TÊN NGƯỜI') && chunkSummarizer.includes('xỉa xói'),
    'chunk prompt no longer demands names and specifics, so conflicts vanish into generalities'
);
check(
    !chunkSummarizer.includes('không trích nguyên văn hội thoại riêng tư'),
    'the blanket privacy clause is back; it covers public chat too and is why bulletins read as vague'
);
// rebuild=true is the only way a prompt change reaches a day already summarized,
// since stored chunks are what the reduce reads and they were written by the old
// prompt. Losing it means prompt fixes silently do nothing for today.
check(
    scheduler.includes('rebuild') && maintenance.includes("getBoolean('rebuild')"),
    'rebuild path is gone, so improving the chunk prompt cannot fix a day already summarized'
);

// Two ways the vision path fails SILENTLY, both of which produced the same
// user-visible symptom ("có nhiều ảnh lắm nhưng nó vẫn báo không thấy ảnh") and
// neither of which shows up as an error anywhere.
//
// 1. The text-only retry must also strip the "look at the attached images"
//    sentence. Keeping it while removing the pictures leaves the model obeying an
//    instruction about something no longer in the payload, so it dutifully reports
//    that it cannot see any image. Losing the pictures is the intended
//    degradation; a summary that talks ABOUT their absence is the bug.
check(
    aiClient.includes('imageInstruction') && chunkSummarizer.includes('imageInstruction:'),
    'text-only retry keeps the "look at the images" instruction, so summaries claim they see no image'
);
// 2. Image collection must page back through history like the text walk does.
//    History is newest-first, so a window that closed hours ago sits far behind
//    the first page — and `/maintenance report rebuild` makes EVERY window a
//    backfill, which is why a single-page fetch returned zero pictures no matter
//    how many had been posted.
check(
    imageCollector.includes('page < maxPages') && imageCollector.includes('before'),
    'image collection is single-page again, so backfilled windows silently find no images'
);
check(
    scheduler.includes('collectChunkImages(client, target.startMs, target.endMs, maxPages)'),
    'scheduler no longer passes its page budget to image collection, so backfill uses the live cap and finds nothing'
);

// Names in the bulletin must be the ones people actually call each other. A
// username like `abc_1234` is unmemorable, so a reader cannot tell who the story
// is about — which defeats the point of naming names at all. The collector is the
// ONLY place that decides this: both prompt tiers are told to keep names exactly
// as they appear in the chat, so a username leaking in here leaks all the way to
// the post.
check(
    chunkCollector.includes('displayNameOf') && !chunkCollector.includes('${msg.author.username}: '),
    'transcript is back to raw usernames, so the bulletin names people unrecognizably'
);
// The humor lives in the reduce prompt, but its raw material has to survive the
// chunk tier: the reduce NEVER re-reads the original chat, so a chunk that omits
// the joke leaves nothing to retell and any wit added later would be invented.
check(
    chunkSummarizer.includes('GHI CẢ PHẦN VUI'),
    'chunk prompt no longer keeps the funny material, so the reduce can only invent it'
);
check(
    dailyComposer.includes('GIỌNG KỂ') && dailyComposer.includes('quả bom gây'),
    'reduce prompt lost its voice guidance, so bulletins read like meeting minutes again'
);

// Hệ nhắc nhở đưa cho bot quyền ping người khác theo lịch, nên mọi chốt dưới đây
// là chốt chống quấy rối, không phải chốt cho gọn code.
//
// 1. Quyền ping người khác phải do ROLE THẬT quyết, không bao giờ do AI đọc ra từ
//    câu chữ. Để model quyết nghĩa là ai cũng viết được "tôi có quyền ping người
//    khác" và nó sẽ tin — tức là bot thành công cụ quấy rối có hẹn giờ.
check(
    reminderHandler.includes('reminderPingOthers') && reminderHandler.includes('target.id === message.author.id'),
    'reminder ping-others gate no longer checks a real role, so anyone can schedule pings at anyone'
);
// 2. Nội dung lời nhắc là chữ người dùng gõ, nên nó phải được gửi với
//    allowedMentions khoá chặt. Thiếu nó thì một lời nhắc chứa "@everyone" sẽ ping
//    cả server, mỗi ngày, theo lịch.
check(
    reminderScheduler.includes('parse: []') && reminderScheduler.includes('roles: []'),
    'reminder send lost its mention allowlist, so reminder text can ping @everyone on a schedule'
);
// 3. Lịch lặp phải dựng lại mốc kế tiếp từ giờ-phút VN, KHÔNG cộng 24h vào mốc cũ:
//    một lần ping trễ sẽ đẩy giờ của mọi ngày sau lệch thêm, trôi dần mãi.
check(
    reminderStore.includes('nextSaigonTime(reminder.hourVn, reminder.minuteVn)'),
    'recurring reminders drift because the next fire time is no longer rebuilt from the VN wall clock'
);
// 4. Emoji riêng của server chỉ dùng được khi model nhận danh sách id THẬT. Dặn
//    "hãy dùng emoji server" mà không đưa danh sách thì nó bịa id, và Discord in
//    nguyên chuỗi `<:abc:123>` ra giữa câu — trông như bot lỗi.
check(
    emojiPalette.includes('buildEmojiHint') && emojiPalette.includes('animated'),
    'emoji palette no longer emits real server emoji ids, so Stella prints broken emoji text'
);

// 5. Tên gợi nhớ là đường tắt BỎ QUA bước ping, nên nó phải là đặc quyền của chủ
//    server. Mở cho mọi người thì một người có role ping-người-khác chỉ cần biết
//    alias là ping được người lạ mà không phải tìm họ trong danh sách — tức là hạ
//    đúng cái ma sát đang bảo vệ người bị ping.
check(
    reminderParser.includes('ownerUserId') && reminderParser.includes('resolveAlias'),
    'reminder alias lookup is no longer owner-only, so it becomes a shortcut around the ping gate'
);
// 6. Lượt AI viết giọng nhây phải LUÔN trả về một câu dùng được. Trả rỗng/null khi
//    gateway chậm nghĩa là mất ping — mà mất ping là mất đúng điều người ta nhờ,
//    tệ hơn nhiều so với một câu nhắc khô.
// Chốt là KIỂU TRẢ VỀ `Promise<string>` chứ không phải "không có chữ null trong
// file": nhánh `.catch` của lượt gọi AI trả null là đúng và cần thiết. Điều phải
// giữ là mọi nhánh đó đều rơi về fallback() trước khi ra khỏi hàm.
check(
    reminderVoice.includes('function fallback')
    && reminderVoice.includes('Promise<string>')
    && !reminderVoice.includes('Promise<string | null>'),
    'reminder voice can return empty, so a slow AI call silently costs the ping itself'
);
// 7. Giọng nhắc do AI viết phải bị tước mention trước khi gửi. allowedMentions đã
//    chặn ping thật, nhưng để nguyên chuỗi `@everyone` trong nội dung thì người đọc
//    vẫn thấy nó và tưởng cả server bị gọi.
check(
    reminderVoice.includes('stripMentions'),
    'reminder voice no longer strips mentions, so AI-written text can display a fake @everyone'
);

// 8. Bộ lọc rẻ chặn trước lượt AI đọc câu phải nhận ĐỦ các động từ nhờ nhắc thật.
//    Bản đầu thiếu "kêu", nên đúng câu mẫu Saly đưa ("nhớ kêu Ri đi tắm") rơi qua
//    Q&A và Stella trả lời là mình không ping được — tính năng có mà như hỏng, và
//    người dùng không có cách nào biết vì sao. Một từ dư chỉ tốn một lượt AI oan;
//    một từ thiếu làm cả một cách nói hợp lệ bị phớt lờ.
check(
    ['kêu', 'nhắc', 'ping', 'gọi', 'réo', 'nhớ'].every(v => reminderParser.includes(v)),
    'reminder intent filter dropped a real way of asking, so those requests fall through to Q&A'
);
// 9. Persona Q&A không được PHỦ NHẬN là mình đặt được nhắc nhở. Khi bộ lọc hụt,
//    câu "Stella không tự ping đúng giờ được" tệ hơn im lặng: người dùng tin và
//    thôi không thử nữa, nên một lỗ nhỏ ở bộ lọc thành mất hẳn tính năng.
// Câu "KHÔNG có công cụ nào" phải được GIỮ — nó chặn model xuất cú pháp gọi tool.
// Thứ bắt buộc có là câu phản bác ngay sau nó, và thứ tự đó là cả điểm: model đọc
// câu chặn tool rộng thành "tôi không làm được gì", nên lời phản bác phải đứng
// liền kề mới đè được.
check(
    qaManager.includes('Stella CÓ hệ nhắc nhở thật')
    && qaManager.includes('không nói "Stella không ping được"')
    && qaManager.indexOf('KHÔNG có công cụ nào') < qaManager.indexOf('Stella CÓ hệ nhắc nhở thật'),
    'Q&A persona claims it cannot schedule pings, which teaches users the feature does not exist'
);

// ---- Nhật báo: ảnh tờ báo + bài tuần (phần bổ sung của feature này) ----
const newspaperCanvas = source('systems/report/newspaper/newspaper-canvas.ts');
const newspaperLayout = source('systems/report/newspaper/newspaper-layout.ts');
const newspaperTextFit = source('systems/report/newspaper/newspaper-text-fit.ts');
const newspaperPipeline = source('systems/report/newspaper/newspaper-pipeline.ts');
const newspaperExtract = source('systems/report/newspaper/newspaper-extract.ts');
const publisher = source('systems/report/report-publisher.ts');
const weekly = source('systems/report/report-weekly.ts');
const weeklyComposer = source('systems/report/report-weekly-composer.ts');
const claimModule = source('systems/report/report-claim.ts');
const dailyStore = source('systems/report/report-daily-store.ts');

// Ảnh là phụ kiện: mọi tầng (extract/image/render) phải fail-soft, không được
// ném lỗi vào runReport hay quyết định `posted`.
check(
    newspaperPipeline.includes('.catch(error =>') && newspaperPipeline.includes('return null'),
    'newspaper pipeline tier is not fail-soft, a failing illustration can kill the bulletin'
);
check(
    scheduler.includes('images ?? undefined') && publisher.includes('images?: Buffer[]'),
    'report images must stay optional attachments so a missing newspaper never changes posting behavior'
);
// Bài tuần chỉ chạy khi đúng Chủ nhật theo giờ SAIGON — đọc host timezone là
// làm mất bài tuần vĩnh viễn trên host ≥ UTC+10 (lỗi im lặng).
check(
    weekly.includes("timeZone: config.maintenance.timezone"),
    'isSundaySaigon must read Saigon time, not the host timezone'
);
// Bài tuần phải tự đánh dấu là "số đặc biệt" qua tiêu đề thread — nếu để mặc
// định, thread mang ngày thứ Hai trông như bản tin ngày bị lệch 6 ngày.
check(
    weekly.includes('WEEKLY_TITLE') && publisher.includes('title?: string'),
    'weekly digest must use its own thread title, not the daily "Bản tin Stella — <date>"'
);
// Chốt chống trùng dùng chung (claim) — scheduler không được tự claim một kiểu
// riêng cho bài tuần.
check(
    claimModule.includes('kind: string') && scheduler.includes("import { claimWork"),
    'weekly claims must go through the shared MaintenanceLog lock'
);
// Chữ bị cắt phải có '…' (wrapTextCapped) — cắt câm làm người đọc tưởng renderer hỏng.
check(
    newspaperTextFit.includes('wrapTextCapped') && newspaperTextFit.includes("'…'"),
    'truncated canvas text must show an ellipsis, not vanish silently'
);
// Band chuyên mục neo vào đáy cố định + headline thu theo chiều cao — trước đây
// headline 2 dòng ngắn làm band biến mất (weekly) hoặc text tràn viền (daily).
check(
    newspaperCanvas.includes('bandHeight') && newspaperCanvas.includes('headlineMaxHeight'),
    'section band must be bottom-anchored with height-aware headline shrinking'
);
// Toàn bộ nội dung bản tin phải được đổ vào nhiều trang ảnh (cột báo) — không
// chỉ trang nhất; giới hạn LAYOUT.maxPages để không spam Discord.
check(
    newspaperCanvas.includes('renderNewspaperPages') &&
    newspaperCanvas.includes('flowTextToBoxes') &&
    newspaperCanvas.includes('LAYOUT.maxPages'),
    'multi-page newspaper rendering (full body into article columns) is missing'
);
check(
    newspaperTextFit.includes('flowTextToBoxes') && newspaperTextFit.includes('Math.floor(maxHeight / lineHeight)'),
    'column flow must split text by measured height so pages never overflow'
);
// Band phải ĐỦ CAO cho label + 2 dòng text ở cỡ mặc định — không có assert này thì
// hạ bandHeight / tăng text.size sau này tái phát lỗi tràn mà không ai biết.
check(
    newspaperLayout.includes('bandHeight: 130') &&
    newspaperLayout.includes('label: { size: 30') &&
    newspaperLayout.includes('text: { size: 24, maxLines: 2'),
    'section band constants changed — recheck that bandHeight >= label height + 2 text lines + padding'
);
// Lưu bài ngày: nguồn duy nhất cho bài tuần (chunk 3h bị prune sau 7 ngày).
check(
    dailyStore.includes('reportDaily.upsert') && scheduler.includes('saveDailyReport(period, body)'),
    'posted daily bulletin must be persisted for the weekly digest'
);

console.log(`Stella self-check passed (${assertionsRun} assertions).`);
