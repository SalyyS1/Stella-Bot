import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    cleanReportText,
    decideEscalation,
    effectiveEscalationLevel,
    nextReportAction,
    reportDayFor,
    reportWindowStart,
    timeoutMatchesRequest,
    validateEvidenceUrl,
    validateReportInput
} from '../src/systems/user-report/report-policy';
import { parseReportActionId, USER_REPORT_KICK_PREFIX } from '../src/systems/user-report/report-alert';

// Đây là code tự dẫn tới timeout/kick proposal, nên test cả hai chiều: không bỏ sót ngưỡng
// thật và không nhận dữ liệu forge/URL lạ. DB race được khoá thêm bằng self-check nguồn.

test('ngày report theo Asia/Saigon, không theo timezone host', () => {
    assert.equal(reportDayFor(new Date('2026-09-12T16:59:59Z')), '2026-09-12');
    assert.equal(reportDayFor(new Date('2026-09-12T17:00:00Z')), '2026-09-13');
});

test('lý do được chuẩn hoá và control character bị bỏ', () => {
    const result = validateReportInput('spam', '  spam\u0000 liên tục  ', null);
    assert.equal(result.reason, 'spam liên tục');
    assert.equal(cleanReportText(' a\u0007b '), 'ab');
});

test('loại report và lý do quá ngắn bị từ chối', () => {
    assert.throws(() => validateReportInput('made-up', 'lý do hợp lệ'), /Loại report/);
    assert.throws(() => validateReportInput('spam', 'x'), /ít nhất/);
});

test('evidence chỉ nhận http/https không có credential', () => {
    assert.equal(validateEvidenceUrl(null), null);
    assert.equal(validateEvidenceUrl('https://discord.com/channels/1/2/3'), 'https://discord.com/channels/1/2/3');
    assert.throws(() => validateEvidenceUrl('file:///etc/passwd'), /http\/https/);
    assert.throws(() => validateEvidenceUrl('https://user:pass@example.com/a'), /đăng nhập/);
    assert.throws(() => validateEvidenceUrl('not-a-url'), /không hợp lệ/);
});

test('leo thang đúng thứ tự: 10 phút, 60 phút, rồi proposal kick', () => {
    assert.deepEqual(nextReportAction(0), { action: 'TIMEOUT_SHORT', nextLevel: 1, durationMs: 600_000 });
    assert.deepEqual(nextReportAction(1), { action: 'TIMEOUT_LONG', nextLevel: 2, durationMs: 3_600_000 });
    assert.deepEqual(nextReportAction(2), { action: 'KICK', nextLevel: 3, durationMs: null });
    assert.equal(nextReportAction(99).action, 'KICK');
});

test('chưa đủ reporter hoặc đang có pending thì không tạo hành động', () => {
    assert.equal(decideEscalation(0, 2, 3, false), null);
    assert.equal(decideEscalation(0, 3, 3, true), null);
    assert.equal(decideEscalation(0, Number.NaN, 3, false), null);
    assert.equal(decideEscalation(0, 999, Number.NaN, false), null, 'ngưỡng hỏng phải tắt auto-action');
    assert.equal(decideEscalation(0, 3, 3, false)?.action, 'TIMEOUT_SHORT');
});

test('cửa sổ report bắt đầu ở mốc muộn hơn giữa 30 ngày và hành động trước', () => {
    const now = new Date('2026-09-13T00:00:00Z');
    const recentAction = new Date('2026-09-12T00:00:00Z');
    assert.equal(reportWindowStart(now, recentAction, 30).toISOString(), recentAction.toISOString());
    assert.equal(
        reportWindowStart(now, new Date('2025-01-01T00:00:00Z'), 30).toISOString(),
        '2026-08-14T00:00:00.000Z'
    );
});

test('cấp xử phạt trở về 0 sau một cửa sổ yên ổn', () => {
    const now = new Date('2026-09-13T00:00:00Z');
    assert.equal(effectiveEscalationLevel(2, new Date('2026-09-01T00:00:00Z'), now, 30), 2);
    assert.equal(effectiveEscalationLevel(2, new Date('2026-07-01T00:00:00Z'), now, 30), 0);
    assert.equal(effectiveEscalationLevel(2, null, now, 30), 0);
    assert.equal(effectiveEscalationLevel(Number.NaN, now, now, 30), 0);
    assert.equal(effectiveEscalationLevel(2, new Date('2027-01-01T00:00:00Z'), now, 30), 0);
});

test('custom id approval chỉ nhận đúng action, snowflake và UUID v4', () => {
    const token = '123e4567-e89b-42d3-a456-426614174000';
    assert.deepEqual(
        parseReportActionId(`${USER_REPORT_KICK_PREFIX}approve_784728722459983874_${token}`),
        { decision: 'approve', targetId: '784728722459983874', token }
    );
    assert.equal(parseReportActionId(`${USER_REPORT_KICK_PREFIX}delete_784728722459983874_${token}`), null);
    assert.equal(parseReportActionId(`${USER_REPORT_KICK_PREFIX}approve_not-id_${token}`), null);
    assert.equal(parseReportActionId(`${USER_REPORT_KICK_PREFIX}approve_784728722459983874_fake-token`), null);
});

test('timeout cũ không bị hiểu nhầm là PATCH timeout mới đã thành công', () => {
    const expected = Date.parse('2026-09-13T12:00:00Z');
    assert.equal(timeoutMatchesRequest(0, expected - 30_000, expected), true);
    assert.equal(timeoutMatchesRequest(expected - 30_000, expected - 30_000, expected), false);
    assert.equal(timeoutMatchesRequest(expected - 3_600_000, expected - 3_600_000, expected), false);
    assert.equal(timeoutMatchesRequest(0, expected - 5 * 60_000, expected), false);
    assert.equal(timeoutMatchesRequest(0, Number.NaN, expected), false);
});
