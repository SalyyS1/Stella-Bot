import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickWinnersWeighted } from '../src/systems/invite/weighted-draw';

// Ly do co test nay: quay co trong so la thu KHONG the kiem tra bang mat. Mot loi
// off-by-one trong khoang cong don van tra ra winner hop le, chi la sai ty le —
// va sai ty le thi khong ai phat hien duoc, chi thay "sao toi khong bao gio trung".

test('trong so cang lon thi ty le trung cang cao, dung xap xi ty le ve', () => {
    const runs = 20_000;
    let heavyWins = 0;

    for (let index = 0; index < runs; index++) {
        const winners = pickWinnersWeighted([
            { userId: 'light', weight: 1 },
            { userId: 'heavy', weight: 9 }
        ], 1);
        if (winners[0] === 'heavy') heavyWins++;
    }

    const ratio = heavyWins / runs;
    // Ky vong 0.9; bien do rong de test khong flaky nhung du chat de bat sai cong thuc.
    assert.ok(ratio > 0.87 && ratio < 0.93, `ty le thang cua ve 9 phai quanh 0.9, nhan duoc ${ratio}`);
});

test('quay nhieu winner khong tra trung cung mot nguoi hai lan', () => {
    for (let index = 0; index < 500; index++) {
        const winners = pickWinnersWeighted([
            { userId: 'a', weight: 5 },
            { userId: 'b', weight: 5 },
            { userId: 'c', weight: 1 }
        ], 2);
        assert.equal(winners.length, 2);
        assert.equal(new Set(winners).size, 2);
    }
});

test('so winner lon hon so nguoi thi tra het nguoi, khong lap', () => {
    const winners = pickWinnersWeighted([
        { userId: 'a', weight: 3 },
        { userId: 'b', weight: 1 }
    ], 5);
    assert.equal(winners.length, 2);
    assert.deepEqual([...winners].sort(), ['a', 'b']);
});

test('ro rong tra ve rong, khong throw', () => {
    assert.deepEqual(pickWinnersWeighted([], 3), []);
});

test('trong so 0 hoac am duoc keo ve 1 chu khong bi loai am tham', () => {
    const winners = pickWinnersWeighted([
        { userId: 'zero', weight: 0 },
        { userId: 'negative', weight: -5 }
    ], 2);
    assert.equal(winners.length, 2);
    assert.deepEqual([...winners].sort(), ['negative', 'zero']);
});

test('nguoi trung lap trong danh sach chi duoc tinh mot suat', () => {
    const winners = pickWinnersWeighted([
        { userId: 'a', weight: 1 },
        { userId: 'a', weight: 50 },
        { userId: 'b', weight: 1 }
    ], 3);
    assert.equal(winners.length, 2);
    assert.deepEqual([...winners].sort(), ['a', 'b']);
});
