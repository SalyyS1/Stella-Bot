import { Client } from 'discord.js';
import { config } from '../../config';
import { isAiEnabled } from '../aiClient';
import { weekKeyFor } from '../weekly-reward-manager';
import { periodOffset } from './report-time-window';
import { loadDailyReports } from './report-daily-store';
import { composeWeeklyReport } from './report-weekly-composer';
import { postReport } from './report-publisher';
import { buildNewspaperImages } from './newspaper/newspaper-pipeline';
import { claimWork, releaseWork } from './report-claim';

// Bài TỔNG HỢP TUẦN VỪA QUA — chạy Chủ nhật, trong tick nhật báo ngay sau khi
// runReport xử lý xong. Đọc lại các bài ngày ĐÃ ĐĂNG (bảng ReportDaily, không
// đọc chunk — chunk bị prune sau 7 ngày và không phải bài hoàn chỉnh), gộp thành
// bài "SỐ ĐẶC BIỆT" + ảnh tờ báo măng-sét đỏ.
//
// KHÔNG đòi hỏi bản tin Chủ nhật đăng ('posted'): Chủ nhật 'empty' (ngày chết)
// không được chặn bài tuần khi tuần vẫn đủ dữ liệu — claim là chốt chống trùng.
//
// "Tuần" = T2→CN (khoá bằng thứ Hai), khớp cửa sổ nhật báo CN 21h → CN 21h.

const WEEKLY_KIND = 'report-weekly';
// Tiêu đề thread bài tuần — KHÔNG dùng mặc định "Bản tin Stella — <ngày>" của
// publisher: bài tuần mang ngày thứ Hai trông như bản tin ngày bị lệch 6 ngày,
// không phân biệt được với bản tin ngày lỗi ngày. Ảnh chỉ là phụ (fail-soft) nên
// tiêu đề là chỗ đánh dấu "số đặc biệt" duy nhất chắc chắn còn.
const WEEKLY_TITLE = 'SỐ ĐẶC BIỆT — TUẦN VỪA QUA';

export type WeeklyOutcome = 'posted' | 'empty' | 'already' | 'disabled';

// Chủ nhật (Saigon)? BẮT BUỘC chỉ rõ timeZone — nếu để Intl dùng giờ host thì trên
// host ≥ UTC+10, Chủ nhật 21h Saigon đã là thứ Hai bên host và bài tuần không bao
// giờ chạy (lỗi im lặng, tuần mất trắng). Đúng mẫu weekKeyFor (weekly-reward-manager).
export function isSundaySaigon(nowMs = Date.now()): boolean {
    const weekday = new Intl.DateTimeFormat('en-CA', {
        timeZone: config.maintenance.timezone,
        weekday: 'short'
    }).format(new Date(nowMs));
    return weekday === 'Sun';
}

function elapsed(startMs: number): string {
    const ms = Date.now() - startMs;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

export async function runWeeklyDigest(client: Client): Promise<WeeklyOutcome> {
    if (!config.report.weekly.enabled) return 'disabled';
    if (!isAiEnabled()) return 'disabled';

    const nowMs = Date.now();
    // Khoá tuần theo ngày thứ Hai Saigon của TUẦN NÀY — bài đăng Chủ nhật tối
    // thuộc tuần mà thứ Hai vừa qua, đọc đúng 7 bài T2→CN.
    const mondayKey = weekKeyFor(new Date(nowMs));

    if (!(await claimWork(WEEKLY_KIND, mondayKey))) {
        console.log(`[report] bài tuần ${mondayKey}: tuần này đã làm rồi (hoặc runner khác) — bỏ qua`);
        return 'already';
    }

    let posted = false;
    const startedAt = Date.now();
    try {
        const periods = Array.from({ length: 7 }, (_, i) => periodOffset(mondayKey, i));
        const days = await loadDailyReports(periods);
        if (days.length < config.report.weekly.minDays) {
            console.log(
                `[report] bài tuần ${mondayKey}: chỉ ${days.length}/7 ngày có bài ` +
                `(cần ≥ ${config.report.weekly.minDays}) — bỏ qua, không đăng rác`
            );
            return 'empty';
        }
        console.log(
            `[report] bài tuần ${mondayKey}: gộp ${days.length} bài ngày trong ${elapsed(startedAt)}`
        );

        const body = await composeWeeklyReport(days, mondayKey);
        if (!body) {
            console.error(`[report] bài tuần: AI không trả kết quả sau ${elapsed(startedAt)} — không đăng`);
            return 'empty';
        }
        console.log(`[report] bài tuần: AI gộp xong ${body.length} ký tự trong ${elapsed(startedAt)}`);

        // Ảnh tờ báo "SỐ ĐẶC BIỆT" (weekly=true: măng-sét đỏ) — nhiều trang như
        // bài ngày. Fail-soft: lỗi thì đăng bài tuần dạng chữ — giống mọi bước phụ
        // khác của nhật báo.
        const images = await buildNewspaperImages(body, mondayKey, { weekly: true }).catch(error => {
            console.error('[report] bài tuần: ảnh thất bại (đăng chữ):', error);
            return null;
        });

        posted = await postReport(client, mondayKey, body, images ?? undefined, WEEKLY_TITLE);
        if (!posted) {
            console.error('[report] bài tuần: ĐĂNG THẤT BẠI (kênh nhật báo sai id hoặc thiếu quyền?)');
        } else {
            console.log(`[report] bài tuần: ĐÃ ĐĂNG (tổng ${elapsed(startedAt)})`);
        }
        return posted ? 'posted' : 'empty';
    } finally {
        // Giữ claim khi ĐÃ đăng (restart không đăng trùng tuần); nhả khi chưa
        // đăng để tick sau thử lại.
        if (!posted) await releaseWork(WEEKLY_KIND, mondayKey);
    }
}
