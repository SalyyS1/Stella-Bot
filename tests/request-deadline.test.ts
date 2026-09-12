import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deadlineLabel, parseRequestDeadline } from '../src/systems/request/request-deadline';

const NOW = new Date('2026-09-13T00:00:00Z');

test('deadline nhận thời lượng ghép và tính từ mốc hiện tại', () => {
    assert.equal(parseRequestDeadline('1h30m', NOW)?.toISOString(), '2026-09-13T01:30:00.000Z');
    assert.equal(parseRequestDeadline('3d', NOW)?.toISOString(), '2026-09-16T00:00:00.000Z');
});

test('none/clear/x/bo đều xoá hạn', () => {
    for (const value of ['none', ' clear ', 'x', 'bo']) {
        assert.equal(parseRequestDeadline(value, NOW), null);
    }
});

test('deadline chặn dưới một giờ, chuỗi rác và trên 365 ngày', () => {
    assert.throws(() => parseRequestDeadline('59m', NOW), /tối thiểu/);
    assert.throws(() => parseRequestDeadline('mai nha', NOW), /không hợp lệ/);
    assert.throws(() => parseRequestDeadline('366d', NOW), /tối đa/);
});

test('nhãn deadline có timestamp Discord và không đặt hạn có câu rõ ràng', () => {
    assert.match(deadlineLabel(parseRequestDeadline('1h', NOW), NOW), /<t:\d+:f> \(<t:\d+:R>\)/);
    assert.equal(deadlineLabel(null, NOW), 'Không đặt hạn');
});
