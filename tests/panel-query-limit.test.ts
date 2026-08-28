import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitedAll, queryLimitState, withQueryLimit } from '../src/panel/data/query-limit';

// Ly do co test nay: tran nay la thu duy nhat ngan panel lam can pool cua bot. Pooler
// Supabase o session mode chi cho 15 client cho ca project, va panel chay TRONG process
// bot nen dung chung pool. Neu tran ro ri mot slot moi lan truy van loi thi sau vai loi
// panel tu treo vinh vien — va no treo im lang, khong log, khong crash.
//
// Hai tinh chat phai dung tuyet doi:
//   1. Khong bao gio co qua MAX truy van chay cung luc.
//   2. Truy van NEM LOI van phai nha slot.

const MAX = queryLimitState().max;

function defer(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

test('tran mac dinh la 4 va bat dau o trang thai sach', () => {
    assert.equal(MAX, 4);
    assert.deepEqual(queryLimitState(), { active: 0, waiting: 0, max: 4 });
});

test('khong bao gio vuot qua MAX truy van song song', async () => {
    let running = 0;
    let peak = 0;

    const tasks = Array.from({ length: 20 }, () => async () => {
        running++;
        peak = Math.max(peak, running);
        // Nhuong mot vong event loop de cac task khac co co hoi chen vao.
        await new Promise(resolve => setTimeout(resolve, 1));
        running--;
        return true;
    });

    await Promise.all(tasks.map(task => withQueryLimit(task)));

    assert.equal(peak, MAX, `dinh phai bang ${MAX}, do duoc ${peak}`);
    assert.deepEqual(queryLimitState(), { active: 0, waiting: 0, max: MAX });
});

test('truy van nem loi van nha slot', async () => {
    const results = await Promise.allSettled(
        Array.from({ length: 12 }, (_unused, index) =>
            withQueryLimit(async () => {
                if (index % 3 === 0) throw new Error('loi gia lap ' + index);
                return index;
            })
        )
    );

    assert.equal(results.filter(r => r.status === 'rejected').length, 4);
    // Day la assertion quan trong nhat ca file: 4 lan loi ma van con du slot.
    assert.deepEqual(queryLimitState(), { active: 0, waiting: 0, max: MAX });

    // Va tran van dung duoc sau do — chung minh khong bi ro ri tich luy.
    assert.equal(await withQueryLimit(async () => 'con dung duoc'), 'con dung duoc');
    assert.equal(queryLimitState().active, 0);
});

test('loi duoc nem nguyen van ra ngoai, khong bi boc lai', async () => {
    await assert.rejects(
        withQueryLimit(async () => {
            throw new Error('nguyen van');
        }),
        /nguyen van/
    );
});

test('task thu MAX+1 phai xep hang chu khong chay ngay', async () => {
    const gates = Array.from({ length: MAX }, () => defer());
    const started: number[] = [];

    const held = gates.map((gate, index) =>
        withQueryLimit(async () => {
            started.push(index);
            await gate.promise;
        })
    );

    // Cho cac task dau tien thuc su bat dau.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(started.length, MAX);
    assert.equal(queryLimitState().active, MAX);

    let extraStarted = false;
    const extra = withQueryLimit(async () => {
        extraStarted = true;
    });

    await new Promise(resolve => setImmediate(resolve));
    assert.equal(extraStarted, false, 'task thu MAX+1 khong duoc chay khi pool day');
    assert.equal(queryLimitState().waiting, 1);

    gates[0].resolve();
    await held[0];
    await extra;
    assert.equal(extraStarted, true, 'task xep hang phai chay khi co slot trong');

    gates.slice(1).forEach(gate => gate.resolve());
    await Promise.all(held);
    assert.deepEqual(queryLimitState(), { active: 0, waiting: 0, max: MAX });
});

test('slot bi giu boi task loi van duoc chuyen cho task dang xep hang', async () => {
    const gates = Array.from({ length: MAX }, () => defer());
    const held = gates.map(gate => withQueryLimit(() => gate.promise));

    await new Promise(resolve => setImmediate(resolve));
    let queuedRan = false;
    const queued = withQueryLimit(async () => {
        queuedRan = true;
    });

    // Task dang giu slot dau tien THAT BAI. Slot phai chuyen sang task xep hang.
    gates[0].reject(new Error('vo giua duong'));
    await assert.rejects(held[0], /vo giua duong/);
    await queued;
    assert.equal(queuedRan, true);

    gates.slice(1).forEach(gate => gate.resolve());
    await Promise.all(held.slice(1));
    assert.deepEqual(queryLimitState(), { active: 0, waiting: 0, max: MAX });
});

test('limitedAll giu dung thu tu ket qua', async () => {
    const results = await limitedAll([
        async () => {
            await new Promise(resolve => setTimeout(resolve, 12));
            return 'cham';
        },
        async () => 'nhanh',
        async () => {
            await new Promise(resolve => setTimeout(resolve, 6));
            return 'vua';
        }
    ] as const);

    assert.deepEqual(results, ['cham', 'nhanh', 'vua']);
    assert.deepEqual(queryLimitState(), { active: 0, waiting: 0, max: MAX });
});

test('limitedAll nhan HAM chu khong nhan Promise da tao', async () => {
    // Ly do rang buoc nay quan trong: mot Promise da tao la mot truy van DA BAY DI. Neu
    // tang du lieu truyen promise vao thi hang doi khong con y nghia gi, va bug do khong
    // he lam test that bai — no chi lam pool vo o production.
    let peak = 0;
    let running = 0;
    const tasks = Array.from({ length: 10 }, () => async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise(resolve => setTimeout(resolve, 1));
        running--;
        return running;
    });

    await limitedAll(tasks);
    assert.ok(peak <= MAX, `dinh ${peak} vuot tran ${MAX}`);
});
