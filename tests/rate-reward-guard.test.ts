import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Prisma } from '@prisma/client';
import {
    decideRateReward,
    RATE_DAILY_LIMIT,
    RATE_PAIR_LIMIT,
    RATE_PAIR_WINDOW_DAYS,
    RATE_SCOIN_PER_STAR
} from '../src/systems/request/rate-reward-guard';

// Lý do có test này: đánh giá 5 sao in ra 50 scoin, và tự nhận đơn của mình đã bị chặn nên
// farm phải dùng hai tài khoản — thứ mà mười phút là có. Chốt chống farm là thứ duy nhất
// đứng giữa hai tài khoản alt và một máy in tiền, nên hai tính chất phải đúng tuyệt đối:
//
//   1. Cặp (người đăng → người nhận) lặp quá trần trong cửa sổ thì KHÔNG trả thưởng.
//   2. Một người nhận quá trần lượt/ngày thì KHÔNG trả thưởng, kể cả khi mỗi cặp đều sạch
//      (đây là ca dùng nhiều alt khác nhau).
//
// Và một tính chất ngược lại cũng quan trọng: khách quay lại LÀ chuyện thật, nên trong trần
// thì phải trả đủ. Chốt chặn oan người làm thật là chốt sẽ bị tắt.

interface Counts {
    pair: number;
    daily: number;
}

interface Recorded {
    pairWhere?: Record<string, unknown>;
    dailyWhere?: Record<string, unknown>;
}

/** Tx giả: chỉ có hai hàm count mà guard thật sự gọi. */
function fakeTx(counts: Counts, recorded: Recorded = {}): Prisma.TransactionClient {
    return {
        requestReview: {
            count: async ({ where }: { where: Record<string, unknown> }) => {
                recorded.pairWhere = where;
                return counts.pair;
            }
        },
        scoinTransaction: {
            count: async ({ where }: { where: Record<string, unknown> }) => {
                recorded.dailyWhere = where;
                return counts.daily;
            }
        }
    } as unknown as Prisma.TransactionClient;
}

const PAIR = { requesterId: '111111111111111111', claimerId: '222222222222222222', rating: 5 };

test('cap sach va chua duoc tra hom nay thi tra du', async () => {
    const decision = await decideRateReward(fakeTx({ pair: 0, daily: 0 }), PAIR);
    assert.equal(decision.suppressed, null);
    assert.equal(decision.scoin, 5 * RATE_SCOIN_PER_STAR);
    assert.equal(decision.contribution, 5);
});

test('thuong ti le voi so sao, khong phai mot muc co dinh', async () => {
    const one = await decideRateReward(fakeTx({ pair: 0, daily: 0 }), { ...PAIR, rating: 1 });
    assert.equal(one.scoin, RATE_SCOIN_PER_STAR);
    assert.equal(one.contribution, 1);
});

test('ngay duoi tran thi van tra — khach quay lai la chuyen that', async () => {
    const decision = await decideRateReward(
        fakeTx({ pair: RATE_PAIR_LIMIT - 1, daily: RATE_DAILY_LIMIT - 1 }),
        PAIR
    );
    assert.equal(decision.suppressed, null);
    assert.equal(decision.scoin, 5 * RATE_SCOIN_PER_STAR);
});

test('cap dung tran thi chan, va chan CA scoin va diem dong gop', async () => {
    const decision = await decideRateReward(fakeTx({ pair: RATE_PAIR_LIMIT, daily: 0 }), PAIR);
    assert.equal(decision.suppressed?.reason, 'pair_limit');
    assert.equal(decision.scoin, 0);
    assert.equal(decision.contribution, 0);
    // Chi tiết phải nói được con số, vì nó đi vào admin log để Saly tự quyết bù hay không.
    assert.match(decision.suppressed?.detail ?? '', new RegExp(String(RATE_PAIR_LIMIT)));
});

test('nhieu alt khac nhau van bi tran luot/ngay chan', async () => {
    // Mỗi cặp sạch (pair: 0) — đây đúng là ca farm bằng nhiều tài khoản khác nhau.
    const decision = await decideRateReward(fakeTx({ pair: 0, daily: RATE_DAILY_LIMIT }), PAIR);
    assert.equal(decision.suppressed?.reason, 'daily_limit');
    assert.equal(decision.scoin, 0);
    assert.equal(decision.contribution, 0);
});

test('vuot ca hai tran thi bao luat cap truoc — thu tu nay la co dinh', async () => {
    const decision = await decideRateReward(
        fakeTx({ pair: RATE_PAIR_LIMIT + 5, daily: RATE_DAILY_LIMIT + 5 }),
        PAIR
    );
    assert.equal(decision.suppressed?.reason, 'pair_limit');
});

test('dem cap dung dung reviewer, target va cua so 30 ngay', async () => {
    const recorded: Recorded = {};
    const before = Date.now();
    await decideRateReward(fakeTx({ pair: 0, daily: 0 }, recorded), PAIR);

    const where = recorded.pairWhere as {
        reviewerId: string;
        targetId: string;
        createdAt: { gte: Date };
    };
    // Đảo chiều reviewer/target là đếm sai người: người nhận đơn mới là người được trả.
    assert.equal(where.reviewerId, PAIR.requesterId);
    assert.equal(where.targetId, PAIR.claimerId);

    const windowMs = RATE_PAIR_WINDOW_DAYS * 86_400_000;
    const gap = before - where.createdAt.gte.getTime();
    assert.ok(gap >= windowMs && gap < windowMs + 5_000, `cua so lech: ${gap}ms`);
});

test('dem luot/ngay chi tinh nguon request:rate va tinh tu nua dem', async () => {
    const recorded: Recorded = {};
    await decideRateReward(fakeTx({ pair: 0, daily: 0 }, recorded), PAIR);

    const where = recorded.dailyWhere as {
        userId: string;
        source: string;
        createdAt: { gte: Date };
    };
    assert.equal(where.userId, PAIR.claimerId);
    // Thiếu lọc source là tính cả /daily, level-up, trivia vào trần này — người chơi bình
    // thường sẽ bị chặn thưởng đánh giá vì hôm nay có điểm danh.
    assert.equal(where.source, 'request:rate');

    // "Từ nửa đêm" khác "24 giờ qua": mốc phải là 00:00 hôm nay, không phải giờ hiện tại trừ 24h.
    const gte = where.createdAt.gte;
    assert.equal(gte.getHours(), 0);
    assert.equal(gte.getMinutes(), 0);
    assert.equal(gte.getSeconds(), 0);
    const today = new Date();
    assert.equal(gte.getDate(), today.getDate());
    assert.equal(gte.getMonth(), today.getMonth());
});
