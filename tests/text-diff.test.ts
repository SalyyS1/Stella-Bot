import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffWords, renderDiffCodeBlock, renderInlineDiff } from '../src/utils/text-diff';

// Ly do co test nay: nut "xem doan da sua" chi co gia tri neu no chi dung cho.
// Diff sai thi mod doc log va ket luan sai ve cai nguoi ta da viet — te hon la
// khong co nut nao.

test('them mot tu giua cau chi danh dau dung tu do', () => {
    const segments = diffWords('toi rat thich cai nay', 'toi rat thich cai nay lam');
    const added = segments.filter(s => s.type === 'add').map(s => s.text.trim()).join('');
    const removed = segments.filter(s => s.type === 'del');
    assert.equal(added, 'lam');
    assert.equal(removed.length, 0);
});

test('xoa mot tu chi danh dau tu bi xoa', () => {
    const segments = diffWords('cai nay rat te', 'cai nay te');
    const removed = segments.filter(s => s.type === 'del').map(s => s.text.trim()).join('');
    assert.equal(removed, 'rat');
});

test('doi hoan toan noi dung thi ca hai phia deu co doan', () => {
    const segments = diffWords('mot hai ba', 'bon nam sau');
    assert.ok(segments.some(s => s.type === 'del'));
    assert.ok(segments.some(s => s.type === 'add'));
    assert.equal(segments.filter(s => s.type === 'same' && s.text.trim()).length, 0);
});

test('chuoi rong khong throw', () => {
    assert.deepEqual(diffWords('', ''), []);
    assert.equal(diffWords('', 'moi').filter(s => s.type === 'add').length, 1);
    assert.equal(diffWords('cu', '').filter(s => s.type === 'del').length, 1);
});

test('van ban rat dai khong treo va bi cat', () => {
    const before = 'tu '.repeat(3000);
    const after = `${before}them`;
    const rendered = renderInlineDiff(before, after, 500);
    assert.ok(rendered.length <= 501, `phai bi cat, nhan duoc ${rendered.length} ky tu`);
});

test('khoi code diff co dong tru va dong cong', () => {
    const block = renderDiffCodeBlock('gia 100k', 'gia 200k');
    assert.match(block, /```diff/);
    assert.match(block, /- .*100k/);
    assert.match(block, /\+ .*200k/);
});

test('khong co thay doi thi khoi code noi ro la khong doi', () => {
    const block = renderDiffCodeBlock('y nguyen', 'y nguyen');
    assert.match(block, /Khong co thay doi|Không có thay đổi/);
});

test('ban gop giu phan khong doi, gach phan xoa, in dam phan them', () => {
    const merged = renderInlineDiff('hom nay troi mua', 'hom nay troi nang');
    assert.match(merged, /hom nay troi/);
    assert.match(merged, /~~mua~~/);
    assert.match(merged, /\*\*nang\*\*/);
});
