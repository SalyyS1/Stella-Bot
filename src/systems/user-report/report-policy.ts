import { config } from '../../config';

// Chính sách report nằm ở file thuần này để mọi ngưỡng đều có thể test mà không cần
// gateway/DB. Report là công cụ bảo vệ cộng đồng, không phải nút "vote kick": một người
// chỉ được tính một lần trong ngày, và ngưỡng chỉ tính những reporter khác nhau.

export const REPORT_CATEGORIES = [
    { value: 'spam', label: 'Spam / flood' },
    { value: 'harassment', label: 'Quấy rối / xúc phạm' },
    { value: 'scam', label: 'Lừa đảo / giả mạo' },
    { value: 'nsfw', label: 'Nội dung không phù hợp' },
    { value: 'other', label: 'Khác' }
] as const;

export type ReportCategory = typeof REPORT_CATEGORIES[number]['value'];
export type ReportAction = 'TIMEOUT_SHORT' | 'TIMEOUT_LONG' | 'KICK';
export type ReportStatus = 'OPEN' | 'DISMISSED' | 'ACTIONED';

export const REPORT_DUPLICATE = 'REPORT_DUPLICATE';
export const REPORT_DAILY_LIMIT = 'REPORT_DAILY_LIMIT';
export const REPORT_INVALID_INPUT = 'REPORT_INVALID_INPUT';

export class ReportPolicyError extends Error {
    constructor(public readonly code: string, message: string) {
        super(message);
        this.name = 'ReportPolicyError';
    }
}

export function isDiscordId(value: string): boolean {
    return /^\d{5,25}$/.test(value);
}

export function isReportCategory(value: string): value is ReportCategory {
    return REPORT_CATEGORIES.some(category => category.value === value);
}

/** Ngày theo múi giờ server, không dùng timezone của máy host. */
export function reportDayFor(at = new Date(), timeZone = config.maintenance.timezone): string {
    if (Number.isNaN(at.getTime())) throw new ReportPolicyError(REPORT_INVALID_INPUT, 'Mốc thời gian report không hợp lệ.');
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(at);
    const get = (type: string) => parts.find(part => part.type === type)?.value || '00';
    return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Bỏ control character và chuẩn hoá Unicode trước khi lưu/log. */
export function cleanReportText(value: string): string {
    return value
        .normalize('NFC')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .trim();
}

export function validateEvidenceUrl(raw: string | null | undefined): string | null {
    const value = raw?.trim() || '';
    if (!value) return null;
    if (value.length > config.userReports.evidenceMaxLength) {
        throw new ReportPolicyError(REPORT_INVALID_INPUT, `Link bằng chứng tối đa ${config.userReports.evidenceMaxLength} ký tự.`);
    }

    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new ReportPolicyError(REPORT_INVALID_INPUT, 'Link bằng chứng không hợp lệ.');
    }
    // Evidence chỉ được lưu để admin tự mở. Không fetch URL này, và không cho URL có
    // user/pass vì một link kiểu đó dễ vô tình làm lộ credential khi admin copy lại.
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new ReportPolicyError(REPORT_INVALID_INPUT, 'Chỉ nhận link http/https không chứa thông tin đăng nhập.');
    }
    return url.toString();
}

export interface ValidatedReportInput {
    category: ReportCategory;
    reason: string;
    evidenceUrl: string | null;
}

export function validateReportInput(
    category: string,
    reason: string,
    evidenceUrl?: string | null
): ValidatedReportInput {
    if (!isReportCategory(category)) {
        throw new ReportPolicyError(REPORT_INVALID_INPUT, 'Loại report không hợp lệ.');
    }
    const cleaned = cleanReportText(reason);
    if (cleaned.length < config.userReports.reasonMinLength) {
        throw new ReportPolicyError(
            REPORT_INVALID_INPUT,
            `Lý do report cần ít nhất ${config.userReports.reasonMinLength} ký tự.`
        );
    }
    if (cleaned.length > config.userReports.reasonMaxLength) {
        throw new ReportPolicyError(
            REPORT_INVALID_INPUT,
            `Lý do report tối đa ${config.userReports.reasonMaxLength} ký tự.`
        );
    }
    return { category, reason: cleaned, evidenceUrl: validateEvidenceUrl(evidenceUrl) };
}

export function reportWindowStart(now: Date, lastActionAt: Date | null, windowDays: number): Date {
    const safeNow = Number.isNaN(now.getTime()) ? new Date() : now;
    const safeWindowDays = Number.isFinite(windowDays) ? Math.max(1, Math.floor(windowDays)) : 30;
    const ageStart = new Date(safeNow.getTime() - safeWindowDays * 86_400_000);
    if (!lastActionAt || Number.isNaN(lastActionAt.getTime())) return ageStart;
    return lastActionAt > ageStart && lastActionAt <= safeNow ? lastActionAt : ageStart;
}

/**
 * Hạ cấp leo thang sau một cửa sổ yên ổn. Không có hàm này, một timeout từ nhiều năm
 * trước vẫn khiến ba report mới nhảy thẳng lên timeout dài/kick — quá nặng và dễ lạm dụng.
 */
export function effectiveEscalationLevel(
    storedLevel: number,
    lastActionAt: Date | null,
    now: Date,
    windowDays: number
): number {
    const level = Number.isFinite(storedLevel) ? Math.max(0, Math.floor(storedLevel)) : 0;
    if (!lastActionAt || Number.isNaN(lastActionAt.getTime()) || Number.isNaN(now.getTime())) return 0;
    const safeWindowDays = Number.isFinite(windowDays) ? Math.max(1, Math.floor(windowDays)) : 30;
    const windowMs = safeWindowDays * 86_400_000;
    const ageMs = now.getTime() - lastActionAt.getTime();
    return ageMs >= 0 && ageMs <= windowMs ? level : 0;
}

export interface EscalationDecision {
    action: ReportAction;
    nextLevel: number;
    durationMs: number | null;
}

export function nextReportAction(level: number): EscalationDecision {
    const safeLevel = Number.isFinite(level) ? Math.max(0, Math.floor(level)) : 0;
    if (safeLevel <= 0) {
        return { action: 'TIMEOUT_SHORT', nextLevel: 1, durationMs: config.userReports.firstTimeoutMs };
    }
    if (safeLevel === 1) {
        return { action: 'TIMEOUT_LONG', nextLevel: 2, durationMs: config.userReports.secondTimeoutMs };
    }
    return { action: 'KICK', nextLevel: safeLevel + 1, durationMs: null };
}

export function decideEscalation(
    level: number,
    distinctReporterCount: number,
    threshold: number,
    hasPending: boolean
): EscalationDecision | null {
    if (hasPending) return null;
    // Threshold hỏng phải fail-closed. `Math.max(1, NaN)` vẫn là NaN; so sánh với NaN
    // đều false và bản cũ vì vậy có thể đi tiếp tới auto-timeout.
    if (!Number.isFinite(threshold)) return null;
    const safeThreshold = Math.max(1, Math.floor(threshold));
    if (!Number.isFinite(distinctReporterCount) || distinctReporterCount < safeThreshold) return null;
    return nextReportAction(level);
}

/**
 * Xác nhận một PATCH timeout có thật sự tới Discord sau khi request phía bot báo lỗi.
 * Chỉ thấy "đang timeout" là chưa đủ: thành viên có thể đã bị mod timeout từ trước.
 */
export function timeoutMatchesRequest(
    previousUntil: number,
    refreshedUntil: number,
    expectedUntil: number,
    toleranceMs = 2 * 60_000
): boolean {
    if (![previousUntil, refreshedUntil, expectedUntil, toleranceMs].every(Number.isFinite)) return false;
    if (toleranceMs < 0 || refreshedUntil <= 0) return false;
    return Math.abs(refreshedUntil - expectedUntil) <= toleranceMs
        && Math.abs(refreshedUntil - previousUntil) > 5_000;
}
