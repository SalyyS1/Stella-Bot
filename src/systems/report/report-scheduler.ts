import { Client } from 'discord.js';
import prisma from '../../lib/prisma';
import { config } from '../../config';
import { isAiEnabled } from '../aiClient';
import {
    saigonNow,
    slotAt,
    lastClosedSlot,
    slotsForDailyReport,
    closedSlotsForDailyReport,
    chunkLockPeriod,
    type SaigonSlot
} from './report-time-window';
import { collectChunkChat } from './report-chunk-collector';
import { collectChunkImages } from './report-image-collector';
import { summarizeChunk } from './report-chunk-summarizer';
import {
    saveChunk,
    loadChunks,
    hasChunk,
    findStoredSlots,
    pruneOldChunks,
    pruneOldChunkClaims
} from './report-chunk-store';
import { composeDailyReport } from './report-daily-composer';
import { gatherServiceBoard, fetchChangelog } from './report-context-sources';
import { postReport } from './report-publisher';
import { askPendingTerms } from '../knowledge/glossary-question-asker';
import { getAnsweredTerms } from '../knowledge/glossary-store';
import { suggestProducts } from './report-owner-suggestion';
import { researchTopics, pickResearchTopics } from './report-web-research';

// Orchestration for the nhật báo. Two jobs on one timer:
//
//   every slot (3h)  -> summarize the window that just closed, store it, post NOTHING
//   once a day (21h) -> fold the last 8 stored windows into the bulletin and post it
//
// Both jobs claim work through MaintenanceLog's unique [channelId, kind, period]
// before doing anything expensive, which is the same lock the single-shot report
// always used. Claim-before-work means a restart or a second instance cannot spend
// AI tokens on a window that is already being handled.

const CHUNK_KIND = 'report-chunk';
const REPORT_KIND = 'report';

// Nhật báo chạy ngầm, mỗi 15 phút một nhịp, và trước đây CHỈ in log khi lỗi. Hệ
// quả: "chạy bình thường" và "chết ngắc" trông giống nhau y hệt trong log — không
// có cách nào biết bot còn sống ngoài việc chờ 21h xem có bản tin hay không, tức
// là phát hiện sự cố sau khi đã mất bản tin. Nên mọi bước giờ đều in một dòng, kể
// cả khi thành công, kèm thời gian chạy.
//
// Đường đắt nhất được đo riêng (đọc chat / gọi AI / đăng bài): với trần 10 phút
// mỗi lượt AI, biết được nó treo ở BƯỚC nào quan trọng hơn nhiều so với biết là
// "có treo". Không log nội dung chat hay bản tóm tắt — chỉ số đo, vì log này
// nằm trên host và chat của member không cần rời khỏi bộ nhớ tạm.
function elapsed(startMs: number): string {
    const ms = Date.now() - startMs;
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`;
}

function logReport(message: string): void {
    // Kèm mốc giờ Saigon: log của host có thể ở UTC, mà mọi mốc trong hệ này
    // (khung 3h, cửa sổ 21h) đều tính theo giờ Saigon. Lệch múi giờ khi đọc log
    // sự cố là đủ để kết luận sai chỗ.
    const { hour, period } = saigonNow();
    console.log(`[report ${period} ${String(hour).padStart(2, '0')}h] ${message}`);
}
// Ticks every 15 minutes rather than hourly. A slot boundary is only detected on a
// tick, so an hourly timer that misses its beat could skip a window entirely; at
// 15 minutes the work is claimed within a quarter hour of the window closing and
// the MaintenanceLog row makes the extra ticks free no-ops.
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

export type ReportOutcome = 'posted' | 'empty' | 'already' | 'disabled';
export type ChunkOutcome = 'saved' | 'empty' | 'already' | 'failed' | 'disabled';

// Claim a unit of work. Returns false when another runner already holds it.
// The unique constraint is the lock: the loser's create throws.
async function claim(kind: string, period: string): Promise<boolean> {
    try {
        await prisma.maintenanceLog.create({
            data: { channelId: config.report.forumChannel, kind, period }
        });
        return true;
    } catch {
        return false;
    }
}

async function release(kind: string, period: string): Promise<void> {
    await prisma.maintenanceLog
        .deleteMany({ where: { channelId: config.report.forumChannel, kind, period } })
        .catch(() => {});
}

// Summarize one closed 3h window into a stored chunk. Never posts anything.
export async function runChunk(client: Client, force = false): Promise<ChunkOutcome> {
    if (!config.report.chunk.enabled) return 'disabled';
    if (!isAiEnabled()) return 'disabled';
    return summarizeSlot(client, lastClosedSlot(), config.report.chunk.maxPagesPerChannel, force);
}

// The work of one slot: read its window, summarize it, store the result. Shared by
// the live tick and the backfill, which differ only in which window they point at
// and how far back through history they are allowed to page.
async function summarizeSlot(
    client: Client,
    target: SaigonSlot,
    maxPages: number,
    force = false
): Promise<ChunkOutcome> {
    const lockPeriod = chunkLockPeriod(target.period, target.slot);

    // A stored row is the real record of "this window is done" — check it before
    // claiming, so a released claim from a failed attempt doesn't cause a window
    // that already succeeded to be summarized a second time.
    if (!force && await hasChunk(target.period, target.slot)) return 'already';

    if (!force && !(await claim(CHUNK_KIND, lockPeriod))) return 'already';

    let settled = false;
    const startedAt = Date.now();
    try {
        logReport(`chunk ${lockPeriod}: bắt đầu đọc chat (trần ${maxPages} trang/kênh)`);
        const chat = await collectChunkChat(client, target.startMs, target.endMs, maxPages);
        logReport(
            `chunk ${lockPeriod}: đọc xong ${chat.msgCount} tin trong ${elapsed(startedAt)}` +
            (chat.reachedStart ? '' : ' — CHƯA tới đầu khung (hết hạn mức trang)')
        );

        // A genuinely quiet window is recorded as an empty row and costs no AI
        // call. The row matters: it stops every later tick from re-reading the
        // same dead window forever.
        //
        // But only when the walk actually reached the start of the window. Running
        // out of page budget also yields zero messages, and storing THAT as an empty
        // row would brand a busy evening a quiet one — permanently, since the row is
        // what tells every later run the window is done. Leave it unrecorded instead
        // so a later backfill with a bigger budget can still rescue it.
        if (!chat.msgCount) {
            if (!chat.reachedStart) {
                console.error(
                    `[report] chunk ${lockPeriod}: ran out of history budget before reaching the window, leaving it unrecorded`
                );
                return 'failed';
            }
            settled = await saveChunk(target.period, target.slot, '', 0);
            logReport(
                `chunk ${lockPeriod}: khung vắng thật, lưu row rỗng (${settled ? 'ok' : 'LƯU THẤT BẠI'})`
            );
            return settled ? 'empty' : 'failed';
        }

        // Có tin nhưng chưa tới đầu khung (reachedStart false) thì VẪN lưu. Nghe
        // ngược với chốt ở trên, nhưng hai tình huống khác nhau: 0 tin + chưa tới
        // đầu khung là "không biết gì", còn có tin là dữ liệu thật, chỉ thiếu phần
        // sớm nhất. Tóm tắt thiếu một đoạn vẫn hơn mất cả khung, và nếu trả 'failed'
        // ở đây thì khung càng bận càng khó lưu — đúng khung cần nhất.
        //
        // Pictures from the whitelisted channels for this same window. Best-effort:
        // a vision failure must never cost the window its text summary, which is
        // the part the bulletin actually depends on.
        //
        // maxPages đi cùng, giống bên text. Không truyền thì lượt vá dùng trần live
        // và không bao giờ lùi đủ xa để tới cửa sổ cần đọc — đó là nửa còn lại của
        // lỗi "nhiều ảnh mà báo không thấy ảnh", vì `rebuild` biến MỌI khung thành
        // khung vá.
        const images = await collectChunkImages(client, target.startMs, target.endMs, maxPages)
            .catch(() => []);

        // Lượt AI được đo riêng vì nó là bước đắt nhất và cũng là bước treo lâu
        // nhất (trần 10 phút). Biết "treo ở lúc gọi AI" khác hẳn biết "tick chạy
        // lâu": một cái là gateway chậm, cái kia có thể là Discord hoặc DB.
        const aiStartedAt = Date.now();
        logReport(
            `chunk ${lockPeriod}: gọi AI tóm tắt (${chat.text.length} ký tự, ${images.length} ảnh)`
        );
        const result = await summarizeChunk(chat.text, target.period, target.slot, images);
        // No summary means the AI call failed. Leave the window unrecorded so the
        // next tick retries it, rather than storing an empty row that would mark a
        // busy window as permanently done.
        if (!result) {
            console.error(
                `[report] chunk ${lockPeriod}: AI không trả kết quả sau ${elapsed(aiStartedAt)} — để khung lại cho lượt sau`
            );
            return 'failed';
        }
        logReport(
            `chunk ${lockPeriod}: AI xong trong ${elapsed(aiStartedAt)} ` +
            `(tóm tắt ${result.summary.length} ký tự, ${result.terms.length} từ lạ)`
        );

        settled = await saveChunk(target.period, target.slot, result.summary, chat.msgCount);
        if (!settled) {
            console.error(`[report] chunk ${lockPeriod}: lưu DB thất bại sau khi đã trả tiền cho lượt AI`);
            return 'failed';
        }
        logReport(`chunk ${lockPeriod}: HOÀN TẤT, tổng ${elapsed(startedAt)}`);

        // Ask the community about any jargon this window surfaced. Deliberately
        // after the chunk is safely stored and never allowed to fail the slot: the
        // glossary is a side feature, and a bad post must not cost us the summary.
        await askPendingTerms(client, result.terms).catch(error =>
            console.error('[report] glossary ask failed:', error)
        );
        return 'saved';
    } catch (error) {
        console.error(`[report] chunk ${lockPeriod} failed:`, error);
        return 'failed';
    } finally {
        // Release on any non-outcome so the window stays retryable. When the chunk
        // WAS stored the claim is deliberately kept: the row and the claim together
        // mark the window finished.
        if (!settled && !force) await release(CHUNK_KIND, lockPeriod);
    }
}

// Vá những cửa sổ đã đóng mà chưa có row — hố sinh ra khi bot chết ngang ranh 3h.
// Không có bước này thì slot đó mất vĩnh viễn: tick sau chỉ nhìn cửa sổ vừa đóng,
// nên không ai quay lại lấy cái đã trượt.
async function runBackfill(client: Client): Promise<number> {
    if (!config.report.chunk.backfill.enabled) return 0;
    // summarizeSlot không tự kiểm AI (chỉ runChunk kiểm), nên chốt ở đây: thiếu key
    // thì mọi lượt vá đều đọc hết lịch sử rồi mới nhận null — tốn quota Discord vô ích.
    if (!isAiEnabled()) return 0;

    const closed = closedSlotsForDailyReport();
    // Bỏ slot mà runChunk vừa lo trong cùng tick này: nó đang giữ claim, backfill
    // nhảy vào chỉ nhận 'already' — tốn một truy vấn cho việc chắc chắn vô ích.
    const live = lastClosedSlot();
    const candidates = closed.filter(
        s => !(s.period === live.period && s.slot === live.slot)
    );
    if (!candidates.length) return 0;

    const stored = await findStoredSlots(
        candidates.map(s => ({ period: s.period, slot: s.slot }))
    );
    const holes = candidates.filter(s => !stored.has(`${s.period}#${s.slot}`));
    if (!holes.length) return 0;

    // Vá từ mới về cũ. Hai lý do: slot gần hiện tại cần ít trang lịch sử hơn nên
    // chắc với tới hơn, và nó cũng là phần bản tin cần nhất. Trần mỗi lượt chặn
    // chi phí — bot chết cả ngày mà vá 8 slot trong một tick là 8 lượt gọi AI liền.
    const budget = config.report.chunk.backfill.maxSlotsPerRun;
    const targets = holes.slice(-budget).reverse();

    let repaired = 0;
    for (const target of targets) {
        const outcome = await summarizeSlot(
            client,
            target,
            config.report.chunk.backfill.maxPagesPerChannel
        );
        // 'empty' cũng là vá xong: cửa sổ đó vắng thật và giờ đã có row chứng minh.
        // Chốt reachedStart trong summarizeSlot đã lọc trường hợp "hết trang chưa
        // tới", nên 'empty' ở đây không thể là hố bị đóng dấu oan.
        if (outcome === 'saved' || outcome === 'empty') repaired++;
    }
    if (repaired) {
        console.log(
            `[report] backfill: vá ${repaired}/${targets.length} slot (còn hở ${holes.length - repaired})`
        );
    }
    return repaired;
}

// Vá MỌI khung còn thiếu của bản tin hôm nay, không giới hạn 2 slot như lượt tự
// động. Chỉ dùng cho lệnh admin.
//
// Lý do phải có: bản tin chỉ gộp chunk ĐÃ lưu trong DB. Ngày bật tính năng lần
// đầu (hoặc bot vừa chết cả ngày) thì DB trống, nên `/maintenance report` sẽ trả
// "không có gì để đăng" — đúng theo code nhưng sai theo điều admin muốn: họ bấm
// lệnh đó chính vì muốn soi lại 24h vừa rồi. Ở đây đọc lại lịch sử Discord để
// dựng đủ 8 khung trước khi gộp.
//
// Trần chi phí bỏ hẳn là có chủ ý: admin gõ tay, biết mình đang gọi, và Saly đã
// chốt không lo chi phí cho đúng đường này. Ngược lại lượt tự động vẫn giữ trần
// 2 slot/tick, vì nó chạy 15 phút một lần mà không ai bấm.
//
// Slot đã có row thì bỏ qua (summarizeSlot tự kiểm), nên gọi lại nhiều lần không
// tốn thêm lượt AI nào.
//
// rebuild=true thì làm LẠI mọi khung, kể cả khung đã có row. Cần đường này vì
// chất lượng bản tin nằm ở chunk, không nằm ở bước gộp: bước gộp KHÔNG bao giờ
// đọc lại chat gốc. Nên sau khi sửa prompt ghi chép, những chunk đã lưu bằng
// prompt cũ vẫn là bản chung chung, và gộp lại bao nhiêu lần cũng ra bản tin
// chung chung y như cũ. Dựng lại là cách duy nhất để prompt mới có tác dụng lên
// một ngày đã trôi qua.
async function backfillAllSlots(client: Client, rebuild = false): Promise<number> {
    if (!isAiEnabled()) return 0;

    const candidates = closedSlotsForDailyReport();
    const stored = await findStoredSlots(
        candidates.map(s => ({ period: s.period, slot: s.slot }))
    );
    // rebuild: mọi khung đã đóng đều là mục tiêu. Ngược lại chỉ những khung chưa
    // có row.
    const targets = rebuild
        ? candidates
        : candidates.filter(s => !stored.has(`${s.period}#${s.slot}`));
    if (!targets.length) return 0;

    logReport(
        rebuild
            ? `admin: DỰNG LẠI toàn bộ ${targets.length} khung (ghi đè ${stored.size} khung đã có)`
            : `admin: ${targets.length} khung còn thiếu, đọc lại lịch sử`
    );

    // Mới về cũ: khung gần hiện tại cần ít trang lịch sử hơn nên chắc với tới hơn,
    // và cũng là phần bản tin cần nhất nếu một khung xa bị hụt trang.
    let repaired = 0;
    for (const target of [...targets].reverse()) {
        const outcome = await summarizeSlot(
            client,
            target,
            config.report.chunk.backfill.maxPagesPerChannel,
            // force khi rebuild: bỏ qua chốt "đã có row" và cho saveChunk ghi đè.
            rebuild
        );
        if (outcome === 'saved' || outcome === 'empty') repaired++;
        else console.error(`[report] admin: khung ${target.period}#${target.slot} thất bại (${outcome})`);
    }

    logReport(`admin: xong ${repaired}/${targets.length} khung`);
    return repaired;
}

// Compose and post the daily bulletin from the stored chunks. force=true bypasses
// the once-a-day guard for a manual admin run.
export async function runReport(
    client: Client,
    force = false,
    rebuild = false
): Promise<ReportOutcome> {
    if (!isAiEnabled()) return 'disabled';
    const { period } = saigonNow();

    if (!force && !(await claim(REPORT_KIND, period))) {
        logReport('bản tin: hôm nay đã đăng rồi (hoặc runner khác đang làm) — bỏ qua');
        return 'already';
    }

    let posted = false;
    const startedAt = Date.now();
    try {
        logReport(
            `bản tin: bắt đầu${force ? ' (lượt admin, bỏ qua chốt 1 lần/ngày)' : ''}` +
            `${rebuild ? ' — DỰNG LẠI toàn bộ ghi chép' : ''}`
        );
        // Lượt admin: dựng lại mọi khung thiếu TRƯỚC khi gộp, để lệnh này thật sự
        // soi lại 24h chứ không chỉ gộp những gì tình cờ đã có trong DB. Đặt trong
        // try để claim vẫn được nhả nếu bước này ném lỗi.
        if (force) {
            await backfillAllSlots(client, rebuild).catch(error =>
                console.error('[report] admin backfill failed:', error)
            );
        }

        const wanted = slotsForDailyReport();
        const [chunks, board, changelog, glossary] = await Promise.all([
            loadChunks(wanted),
            gatherServiceBoard(),
            fetchChangelog(),
            // Community-taught vocabulary, so the bulletin can use the server's own
            // jargon instead of guessing at it. Best-effort: a glossary failure must
            // not stop the report.
            getAnsweredTerms().catch(() => [])
        ]);

        logReport(
            `bản tin: có ${chunks.length}/${wanted.length} khung ghi chép, ` +
            `${chunks.reduce((sum, c) => sum + c.msgCount, 0)} tin, ` +
            `board ${board ? 'có' : 'rỗng'}, changelog ${changelog ? 'có' : 'không'}, ` +
            `từ điển ${glossary.length} từ (${elapsed(startedAt)})`
        );

        // Nothing summarized all day and nothing on the board: a dead day, skip.
        if (!chunks.length && !board) {
            logReport('bản tin: KHÔNG có ghi chép nào và board rỗng — bỏ qua, không đăng');
            return 'empty';
        }

        // Look up outside facts for a couple of the day's own subjects. Topics are
        // the jargon the community explained today — concrete nouns tied to real
        // demand, chosen without an extra AI call. Inert unless RESEARCH_API_KEY is
        // set, and best-effort either way: the bulletin never waits on the web.
        const topics = pickResearchTopics(glossary.map(g => g.term));
        const research = await researchTopics(topics).catch(() => null);
        if (topics.length) {
            logReport(
                `bản tin: tra web ${topics.length} chủ đề (${topics.join(', ')}) — ` +
                `${research ? `${research.length} ký tự` : 'không có kết quả / đang tắt'}`
            );
        }

        // Bước đắt nhất và lâu nhất của cả hệ: trần 15 phút, input là toàn bộ ghi
        // chép của ngày. Đo riêng vì treo ở đây khác hẳn treo ở lúc đọc chat —
        // một cái là gateway, một cái là Discord.
        const composeAt = Date.now();
        logReport('bản tin: gọi AI gộp ghi chép thành bản tin (bước lâu nhất)');
        const body = await composeDailyReport(
            chunks,
            board,
            changelog,
            period,
            config.report.chunk.slotHours,
            glossary,
            research
        );
        if (!body) {
            console.error(
                `[report] bản tin: AI gộp KHÔNG trả về gì sau ${elapsed(composeAt)} — không đăng, giữ chỗ cho lượt sau`
            );
            return 'empty';
        }
        logReport(`bản tin: AI gộp xong ${body.length} ký tự trong ${elapsed(composeAt)}`);

        posted = await postReport(client, period, body);
        if (!posted) {
            console.error('[report] bản tin: ĐĂNG THẤT BẠI (kênh nhật báo sai id hoặc thiếu quyền?)');
        } else {
            logReport(`bản tin: ĐÃ ĐĂNG (tổng ${elapsed(startedAt)})`);
        }
        if (posted) {
            await pruneOldChunks();
            // The spent work-claims for those same aged-out windows. Separate call
            // because it writes to a shared table and is scoped by kind, not by date
            // alone — see pruneOldChunkClaims.
            await pruneOldChunkClaims();
            // Owner-facing product ideas, derived from the same chunks the bulletin
            // used. Runs after the public post and never affects its outcome: this
            // is a private nicety, not part of the report contract.
            await suggestProducts(client, chunks, period, config.report.chunk.slotHours).catch(error =>
                console.error('[report] owner suggestion failed:', error)
            );
        }
        return posted ? 'posted' : 'empty';
    } finally {
        // Release a spent-but-unposted claim so a transient failure doesn't burn
        // the whole day.
        if (!posted && !force) await release(REPORT_KIND, period);
    }
}

// One timer drives both jobs. Ordering matters: the chunk for the window that just
// closed is summarized BEFORE the daily reduce runs, so the 21:00 bulletin includes
// the 18:00-21:00 window instead of missing the whole evening.
export function startReportScheduler(client: Client): void {
    let running = false;
    let tickCount = 0;

    const tick = async () => {
        // The tick does network + AI work that can outlast the interval; a busy
        // guard keeps a slow run from overlapping itself. The DB claims already
        // make double work harmless, this just avoids the wasted attempt.
        if (running) {
            // Bỏ qua vì lượt trước CHƯA xong — phải nói ra. Một tick treo (AI
            // không trả, timeout 10 phút chưa tới) sẽ làm mọi nhịp sau đó lặng lẽ
            // trả về ở đây; không có dòng này thì log trông y như bot đã chết.
            logReport('tick: bỏ qua — lượt trước còn đang chạy');
            return;
        }
        running = true;
        const tickStartedAt = Date.now();
        tickCount++;
        try {
            // Giờ được chụp Ở ĐẦU tick, không phải sau khi làm chunk. Cửa sổ đăng
            // bản tin chỉ dài 1 tiếng (21-22h), còn phần chunk+backfill giờ có thể
            // mất tới 30 phút (1 chunk + 2 slot vá, mỗi lượt trần 10 phút). Đọc giờ
            // sau khi làm xong thì một tick bắt đầu lúc 21:45 sẽ kiểm lúc 22:15 và
            // bỏ bản tin của CẢ NGÀY — mất trắng sau khi đã trả tiền cho 8 lượt
            // chunk. Chụp trước nghĩa là: đã tới giờ lúc bắt đầu thì vẫn đăng, dù
            // phần ghi chép chạy lâu hơn dự kiến.
            const { hour } = saigonNow();
            const dueForDaily = hour >= config.report.hourStart && hour < config.report.hourEnd;

            // NHỊP TIM. Dòng duy nhất chắc chắn in ra mỗi 15 phút dù không có việc
            // gì để làm — đó chính là điểm: nếu log im hơn 15 phút thì scheduler đã
            // chết, không cần chờ tới 21h mới biết.
            logReport(
                `tick #${tickCount}: đang sống, khung hiện tại ${slotAt(Date.now()).slot}, ` +
                `bản tin ${dueForDaily ? 'ĐẾN GIỜ' : `chờ ${config.report.hourStart}h`}`
            );

            if (config.report.chunk.enabled) {
                await runChunk(client).catch(error =>
                    console.error('[report] chunk tick failed:', error)
                );
                // Vá hố SAU cửa sổ vừa đóng. Thứ tự có chủ ý: slot mới nhất là phần
                // bản tin cần nhất nên phải được lo trước khi ngân sách vá bị dùng
                // hết, và runBackfill cũng bỏ đúng slot mà runChunk vừa xử lý.
                await runBackfill(client).catch(error =>
                    console.error('[report] backfill tick failed:', error)
                );
            }

            if (dueForDaily) {
                await runReport(client).catch(error =>
                    console.error('[report] daily tick failed:', error)
                );
            }
        } finally {
            running = false;
            // Đóng cặp với dòng nhịp tim. Có "xong" mới phân biệt được tick chạy
            // lâu và tick chết giữa đường: thấy mở mà không thấy đóng nghĩa là nó
            // đang treo ở một bước nào đó phía trên.
            logReport(`tick #${tickCount}: xong sau ${elapsed(tickStartedAt)}`);
        }
    };

    // In một dòng lúc bật, kèm cấu hình thật đang chạy. Sự cố hay gặp nhất không
    // phải code sai mà là config/env ở host khác với ở đây (chunk bị tắt, thiếu
    // AI_API_KEY, sai kênh) — và không có dòng này thì cả hai trường hợp đều biểu
    // hiện y hệt nhau: log trống trơn.
    logReport(
        `scheduler bật: nhịp ${CHECK_INTERVAL_MS / 60_000} phút, khung ${config.report.chunk.slotHours}h, ` +
        `bản tin ${config.report.hourStart}-${config.report.hourEnd}h, ` +
        `chunk ${config.report.chunk.enabled ? 'bật' : 'TẮT'}, AI ${isAiEnabled() ? 'bật' : 'TẮT'}, ` +
        `${config.report.sourceChannels.length} kênh nguồn`
    );

    void tick();
    setInterval(() => void tick(), CHECK_INTERVAL_MS);
}

// Exported for the admin command: report which windows of the current day have
// been summarized, so a thin bulletin can be traced to missing chunks.
export async function reportChunkStatus(): Promise<{
    period: string;
    stored: number;
    expected: number;
    currentSlot: number;
}> {
    const now = slotAt(Date.now());
    const wanted = slotsForDailyReport();
    const chunks = await loadChunks(wanted);
    return {
        period: now.period,
        stored: chunks.length,
        expected: wanted.length,
        currentSlot: now.slot
    };
}
