import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEventStart, wallToUTC } from '../src/systems/scheduled-events/saigon-time';

// Lý do có test này: sự kiện hẹn giờ sai múi giờ là lỗi IM LẶNG — bot tạo event, Discord
// nhắc, nhưng nhắc sai 7 tiếng, và admin chỉ phát hiện khi thành viên đã vào hụt.
// Giờ phải được hiểu theo giờ Việt Nam rồi đổi sang UTC đúng, không hard-code offset.

test('wallToUTC: 20:00 Saigon ra 13:00 UTC (+7, khong DST)', () => {
    const utc = wallToUTC('Asia/Ho_Chi_Minh', 2026, 9, 10, 20, 0);
    assert.equal(utc.toISOString(), '2026-09-10T13:00:00.000Z');
});

test('parseEventStart: HH:MM dd/mm, nam hien tai cua mui gio (khong phai UTC)', () => {
    // 6/9/2026 19:00 Saigon = 12:00 UTC — "nam hien tai" tinh theo Saigon.
    const parsed = parseEventStart('20:00 10/09', new Date('2026-09-06T12:00:00Z'));
    assert.ok(parsed);
    assert.equal(parsed.toISOString(), '2026-09-10T13:00:00.000Z');
});

test('parseEventStart: nam day du, so mot chu so, gio co so 0', () => {
    assert.equal(parseEventStart('09:30 01/01/2027')?.toISOString(), '2027-01-01T02:30:00.000Z');
    assert.equal(parseEventStart('8:05 1/2', new Date('2026-09-06T12:00:00Z'))?.toISOString(), '2026-02-01T01:05:00.000Z');
});

test('parseEventStart: dd/mm — "13/09" la ngay 13 thang 9, hop le', () => {
    assert.equal(parseEventStart('20:00 13/09', new Date('2026-09-06T12:00:00Z'))?.toISOString(), '2026-09-13T13:00:00.000Z');
});

test('parseEventStart: tu choi dinh dang sai va ngay khong co that', () => {
    // Chu y: dinh dang la dd/mm — "13/09" la 13 thang 9, HOP LE; thang 13 phai viet "10/13".
    const bad = ['', '20:00', '10/09', '25:00 10/09', '20:60 10/09', '20:00 0/09', '20:00 31/02', '20:00 10/13', '20:00 32/10', '20h00 10/09', '20:00 10-09'];
    for (const input of bad) {
        assert.equal(parseEventStart(input), null, `phai tu choi: "${input}"`);
    }
    // 31/02 khong duoc thanh 03/03 (Date.UTC tu cuon ngay tran).
    assert.equal(parseEventStart('12:00 31/02/2027'), null);
});
