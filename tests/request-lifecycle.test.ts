import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    decideStaleOpen,
    isOverdue,
    shouldRemindRating,
    type StaleThresholds
} from '../src/systems/request/request-lifecycle';
import {
    isRequestEditable,
    parseRequestEditId,
    REQUEST_EDIT_PREFIX
} from '../src/systems/request/request-edit';

// Lý do có test này: đây là code TỰ ĐÓNG ĐƠN CỦA NGƯỜI KHÁC mà không ai bấm nút. Sai ngưỡng
// một chiều thì đơn còn sống bị đóng oan; sai chiều kia thì bảng đơn đầy rác. Cả hai đều chỉ
// lộ ra sau nhiều ngày, khi đã muộn. Chốt quan trọng nhất: KHÔNG BAO GIỜ đóng một đơn chưa
// được nhắc lần nào.

const limits: StaleThresholds = { openRemindDays: 7, openCloseDays: 14, rateRemindDays: 3 };
const NOW = new Date('2026-09-07T12:00:00Z');

function daysBefore(days: number): Date {
    return new Date(NOW.getTime() - days * 86_400_000);
}

test('don con moi thi khong dung toi', () => {
    assert.equal(decideStaleOpen(daysBefore(0), null, limits, NOW), 'none');
    assert.equal(decideStaleOpen(daysBefore(6.9), null, limits, NOW), 'none');
});

test('qua 7 ngay thi nhac, nhac roi thi thoi', () => {
    assert.equal(decideStaleOpen(daysBefore(7), null, limits, NOW), 'remind');
    assert.equal(decideStaleOpen(daysBefore(10), null, limits, NOW), 'remind');
    // Da nhac roi va chua toi moc dong: khong nhac lai moi gio.
    assert.equal(decideStaleOpen(daysBefore(10), daysBefore(3), limits, NOW), 'none');
});

test('qua 14 ngay VA da nhac thi moi dong', () => {
    assert.equal(decideStaleOpen(daysBefore(14), daysBefore(7), limits, NOW), 'close');
    assert.equal(decideStaleOpen(daysBefore(40), daysBefore(30), limits, NOW), 'close');
});

test('CHUA NHAC LAN NAO thi khong bao gio dong thang, du don rat cu', () => {
    // Ca that: bot vua bat tinh nang nay, hoac scheduler chet may ngay. Don 6 thang tuoi
    // van phai duoc nhac mot luot roi moi dong o luot sau.
    assert.equal(decideStaleOpen(daysBefore(180), null, limits, NOW), 'remind');
    assert.equal(decideStaleOpen(daysBefore(14), null, limits, NOW), 'remind');
});

test('qua han: chi khi co dueDate, da qua, va chua nhac', () => {
    assert.equal(isOverdue(daysBefore(1), null, NOW), true);
    assert.equal(isOverdue(new Date(NOW.getTime() + 86_400_000), null, NOW), false, 'han con o tuong lai');
    assert.equal(isOverdue(null, null, NOW), false, 'khong dat han thi khong the tre han');
    assert.equal(isOverdue(daysBefore(5), daysBefore(1), NOW), false, 'da nhac roi thi thoi');
});

test('nhac danh gia: qua 3 ngay, mot lan duy nhat', () => {
    assert.equal(shouldRemindRating(daysBefore(3), null, limits, NOW), true);
    assert.equal(shouldRemindRating(daysBefore(2), null, limits, NOW), false);
    assert.equal(shouldRemindRating(daysBefore(30), daysBefore(20), limits, NOW), false, 'da nhac roi');
    assert.equal(shouldRemindRating(null, null, limits, NOW), false, 'chua hoan thanh thi khong nhac');
});

test('parse id nut sua don: chi nhan so duong', () => {
    assert.equal(parseRequestEditId(`${REQUEST_EDIT_PREFIX}42`), 42);
    assert.equal(parseRequestEditId(`${REQUEST_EDIT_PREFIX}0`), null);
    assert.equal(parseRequestEditId(`${REQUEST_EDIT_PREFIX}-1`), null);
    assert.equal(parseRequestEditId(`${REQUEST_EDIT_PREFIX}abc`), null);
    assert.equal(parseRequestEditId('request_close_42'), null);
    assert.equal(parseRequestEditId(''), null);
});

test('pham vi va ngan sach bi khoa ngay khi co nguoi nhan', () => {
    assert.equal(isRequestEditable('OPEN'), true);
    assert.equal(isRequestEditable('CLAIMED'), false);
    assert.equal(isRequestEditable('DONE'), false);
    assert.equal(isRequestEditable('RATED'), false);
    assert.equal(isRequestEditable('CLOSED'), false);
});
