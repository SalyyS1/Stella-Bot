import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { adjustScoin, settleScoinWager } from '../src/systems/scoinManager';
import { rateRequest } from '../src/systems/requestManager';
import { joinGiveaway } from '../src/systems/giveawayManager';
import {
    prisma,
    ensureTestMarker,
    truncateAll,
    seedUser,
    getUser,
    countTransactions,
    disconnect,
    stubClient
} from './helpers/test-db';

// Real threat = a double-click / two-device race, not a load test. 3 concurrent
// calls exercise the same `updateMany(...count===0)` atomic guard as 20 would.
const RACE = 3;

before(async () => {
    await ensureTestMarker();
});

beforeEach(async () => {
    await truncateAll();
});

after(async () => {
    await disconnect();
});

// rateRequest: DONE -> RATED transition pays the claimer once. Concurrent rate
// clicks must produce exactly one reward ledger row.
test('rateRequest pays out exactly once under concurrent clicks', async () => {
    const requesterId = 'requester-1';
    const claimerId = 'claimer-1';
    await seedUser(requesterId);
    await seedUser(claimerId);

    const request = await prisma.requestPost.create({
        data: {
            channelId: 'chan-1',
            requesterId,
            kind: 'PAID',
            service: 'design',
            description: 'test job',
            status: 'DONE',
            claimedById: claimerId
        }
    });

    const client = stubClient();
    const results = await Promise.allSettled(
        Array.from({ length: RACE }, () => rateRequest(client, 'guild-1', request.id, requesterId, 5))
    );

    const fulfilled = results.filter(r => r.status === 'fulfilled').length;
    assert.equal(fulfilled, 1, 'exactly one rate call should succeed');

    const rewardRows = await countTransactions('request:rate');
    assert.equal(rewardRows, 1, 'exactly one reward ledger row');

    const claimer = await getUser(claimerId);
    assert.equal(claimer.scoinBalance, 50, 'rating*10 credited once');
    assert.equal(claimer.contributionScore, 5, 'contribution credited once');
});

// joinGiveaway: entryCost charge is a conditional decrement. Concurrent joins by
// the same user must charge at most once (unique entry) and never overspend.
test('joinGiveaway charges entry cost at most once under concurrent joins', async () => {
    const userId = 'joiner-1';
    await seedUser(userId, 100);

    const giveaway = await prisma.giveaway.create({
        data: {
            channelId: 'chan-1',
            title: 'GA',
            description: 'desc',
            prize: 'prize',
            hostId: 'host-1',
            winnersCount: 1,
            endsAt: new Date(Date.now() + 60_000),
            status: 'ACTIVE',
            entryCost: 30
        }
    });

    // No guild membership needed: no requiredRole/minLevel/minScoin set, so
    // checkRequirements passes. Pass a guild stub that returns no member.
    const guild = { members: { fetch: async () => null } } as any;

    await Promise.allSettled(
        Array.from({ length: RACE }, () => joinGiveaway(stubClient(), guild, giveaway.id, userId))
    );

    const entries = await prisma.giveawayEntry.count({ where: { giveawayId: giveaway.id, userId } });
    assert.equal(entries, 1, 'exactly one entry');

    const charges = await prisma.scoinTransaction.count({ where: { source: 'giveaway:entry' } });
    assert.equal(charges, 1, 'charged exactly once');

    const user = await getUser(userId);
    assert.equal(user.scoinBalance, 70, 'balance decremented once (100 - 30)');
});

// settleScoinWager: a losing double-settle must not double-charge below zero.
test('settleScoinWager never overspends under concurrent settles', async () => {
    const userId = 'gambler-1';
    await seedUser(userId, 50);

    // bet=50, payout=0 (a loss). Two concurrent settles: only one can pass the
    // `scoinBalance >= bet` conditional decrement; the other must throw.
    const results = await Promise.allSettled(
        Array.from({ length: RACE }, () => settleScoinWager(userId, 50, 0, 'coinflip loss', 'game:coinflip'))
    );

    const fulfilled = results.filter(r => r.status === 'fulfilled').length;
    assert.equal(fulfilled, 1, 'only one settle should succeed with balance=50, bet=50');

    const user = await getUser(userId);
    assert.equal(user.scoinBalance, 0, 'balance never goes negative');
});

// adjustScoin negative guard: concurrent debits must not drive balance negative.
test('adjustScoin negative debit respects balance floor under concurrency', async () => {
    const userId = 'spender-1';
    await seedUser(userId, 100);

    const results = await Promise.allSettled(
        Array.from({ length: RACE }, () => adjustScoin(userId, -100, 'spend', 'test:spend'))
    );

    const fulfilled = results.filter(r => r.status === 'fulfilled').length;
    assert.equal(fulfilled, 1, 'only one full-balance debit can succeed');

    const user = await getUser(userId);
    assert.equal(user.scoinBalance, 0, 'balance floored at zero');
});
