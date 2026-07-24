import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';

type PrismaTx = Prisma.TransactionClient;

export const SCOIN_REWARDS = {
    votePlus: 2,
    dailyBase: 20,
    dailyPerStreak: 2,
    dailyCap: 80,
    levelBase: 50,
    levelPerLevel: 10
};

export function dailyScoinReward(streak: number): number {
    return Math.min(SCOIN_REWARDS.dailyCap, SCOIN_REWARDS.dailyBase + Math.max(0, streak - 1) * SCOIN_REWARDS.dailyPerStreak);
}

export function levelScoinReward(level: number): number {
    return SCOIN_REWARDS.levelBase + Math.max(0, level - 1) * SCOIN_REWARDS.levelPerLevel;
}

export async function ensureScoinUser(userId: string): Promise<void> {
    await prisma.user.upsert({
        where: { id: userId },
        update: {},
        create: { id: userId }
    });
}

export async function adjustScoin(
    userId: string,
    amount: number,
    reason: string,
    source: string,
    metadata?: string,
    allowNegative = false
) {
    return prisma.$transaction(tx => adjustScoinTx(tx, userId, amount, reason, source, metadata, allowNegative));
}

export async function settleScoinWager(
    userId: string,
    bet: number,
    payout: number,
    reason: string,
    source: string,
    metadata?: string
) {
    if (bet <= 0 || payout < 0) throw new Error('Invalid wager.');

    return prisma.$transaction(async tx => {
        await tx.user.upsert({ where: { id: userId }, update: {}, create: { id: userId } });
        const charged = await tx.user.updateMany({
            where: { id: userId, scoinBalance: { gte: bet } },
            data: { scoinBalance: { decrement: bet } }
        });
        if (charged.count === 0) throw new Error('Not enough Scoin.');

        const net = payout - bet;
        if (payout > 0) {
            await tx.user.update({
                where: { id: userId },
                data: {
                    scoinBalance: { increment: payout },
                    scoinEarnedTotal: net > 0 ? { increment: net } : undefined
                }
            });
        }
        await tx.scoinTransaction.create({ data: { userId, amount: net, reason, source, metadata } });
        return tx.user.findUniqueOrThrow({ where: { id: userId } });
    });
}

export async function setScoin(userId: string, amount: number, reason: string, source = 'admin', metadata?: string) {
    if (amount < 0) throw new Error('Scoin balance cannot be negative.');

    return prisma.$transaction(async tx => {
        await tx.user.upsert({
            where: { id: userId },
            update: {},
            create: { id: userId }
        });
        await tx.user.update({ where: { id: userId }, data: { scoinBalance: { increment: 0 } } });
        const current = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        const delta = amount - current.scoinBalance;
        if (delta === 0) return current;

        await tx.scoinTransaction.create({
            data: { userId, amount: delta, reason, source, metadata }
        });
        return tx.user.update({
            where: { id: userId },
            data: {
                scoinBalance: amount,
                scoinEarnedTotal: delta > 0 ? { increment: delta } : undefined
            }
        });
    });
}

export async function adjustScoinTx(
    tx: PrismaTx,
    userId: string,
    amount: number,
    reason: string,
    source: string,
    metadata?: string,
    allowNegative = false
) {
    if (amount === 0) {
        return tx.user.upsert({
            where: { id: userId },
            update: {},
            create: { id: userId }
        });
    }

    await tx.user.upsert({
        where: { id: userId },
        update: {},
        create: { id: userId }
    });

    if (amount < 0 && !allowNegative) {
        const debited = await tx.user.updateMany({
            where: { id: userId, scoinBalance: { gte: -amount } },
            data: { scoinBalance: { increment: amount } }
        });
        if (debited.count === 0) throw new Error('Not enough Scoin.');
    } else {
        await tx.user.update({
            where: { id: userId },
            data: {
                scoinBalance: { increment: amount },
                scoinEarnedTotal: amount > 0 ? { increment: amount } : undefined
            }
        });
    }

    await tx.scoinTransaction.create({
        data: { userId, amount, reason, source, metadata }
    });

    return tx.user.findUniqueOrThrow({ where: { id: userId } });
}

export async function getScoinBalance(userId: string): Promise<number> {
    const user = await prisma.user.upsert({
        where: { id: userId },
        update: {},
        create: { id: userId }
    });
    return user.scoinBalance;
}
