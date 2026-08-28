import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBudgetInput, formatBudget } from '../src/systems/request/budget-parser';

// Ly do co test nay: gia da chuan hoa la thu duoc dung de sort, loc tam gia va thong ke.
// Parser hieu sai mot kieu viet pho bien thi khong phai "hien thi hoi la" — la ca danh
// sach don xep sai thu tu ma khong ai biet vi sao. Chuoi goc van con o cot "budget".

test('kieu viet tat cua nguoi Viet ra dung so', () => {
    assert.deepEqual(parseBudgetInput('500k'), { amount: 500_000, currency: 'VND' });
    assert.deepEqual(parseBudgetInput('1tr'), { amount: 1_000_000, currency: 'VND' });
    assert.deepEqual(parseBudgetInput('1M'), { amount: 1_000_000, currency: 'VND' });
    assert.deepEqual(parseBudgetInput('2 trieu'), { amount: 2_000_000, currency: 'VND' });
});

test('1tr5 la mot trieu nam, khong phai 15 trieu', () => {
    assert.deepEqual(parseBudgetInput('1tr5'), { amount: 1_500_000, currency: 'VND' });
    assert.deepEqual(parseBudgetInput('1m5'), { amount: 1_500_000, currency: 'VND' });
});

test('dau phan cach: co don vi do lon thi la dau thap phan, khong co thi la phan cach nghin', () => {
    assert.deepEqual(parseBudgetInput('1.5tr'), { amount: 1_500_000, currency: 'VND' });
    assert.deepEqual(parseBudgetInput('1.500.000'), { amount: 1_500_000, currency: 'VND' });
    assert.deepEqual(parseBudgetInput('1,500,000'), { amount: 1_500_000, currency: 'VND' });
});

test('don vi tien nhan dang duoc, mac dinh la VND', () => {
    assert.deepEqual(parseBudgetInput('60 USD'), { amount: 60, currency: 'USD' });
    assert.deepEqual(parseBudgetInput('$60'), { amount: 60, currency: 'USD' });
    assert.deepEqual(parseBudgetInput('1.500.000 VND'), { amount: 1_500_000, currency: 'VND' });
    assert.deepEqual(parseBudgetInput('300000'), { amount: 300_000, currency: 'VND' });
});

test('tran theo tung don vi: 500 trieu VND qua tran, 60 USD thi khong', () => {
    assert.equal(parseBudgetInput('900tr'), null);
    assert.deepEqual(parseBudgetInput('400tr'), { amount: 400_000_000, currency: 'VND' });
    // Cung con so 400 trieu nhung la USD thi phai bi chan — tran cua USD la 20k.
    assert.equal(parseBudgetInput('400000000 USD'), null);
});

test('rac va so khong hop le ra null chu khong ra NaN', () => {
    assert.equal(parseBudgetInput(''), null);
    assert.equal(parseBudgetInput(null), null);
    assert.equal(parseBudgetInput('thuong luong'), null);
    assert.equal(parseBudgetInput('0'), null);
    assert.equal(parseBudgetInput('-500k'), null);
});

test('khoang gia bi tu choi thay vi doan bua mot dau', () => {
    // Bo dau phan cach roi ghep chu so lai se ra 500000001 — con so khong ai go ra.
    assert.equal(parseBudgetInput('500k-1tr'), null);
    assert.equal(parseBudgetInput('1~2tr'), null);
    assert.equal(parseBudgetInput('500k den 1tr'), null);
});

test('chu k trong tu tieng Viet khong bien thanh nghin', () => {
    // "khoang 2000" — chu 'k' dung dau tu, khong dung sau chu so.
    assert.deepEqual(parseBudgetInput('khoang 2000'), { amount: 2_000, currency: 'VND' });
});

test('formatBudget lui ve chuoi goc khi chua parse duoc', () => {
    assert.equal(formatBudget(1_500_000, 'VND', null), '1.500.000 VND');
    assert.equal(formatBudget(null, null, 'thuong luong'), 'thuong luong');
    assert.equal(formatBudget(null, null, null), 'Chưa ghi');
});
