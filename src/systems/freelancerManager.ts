import { Client, Guild } from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';
import { markInternalAntiRaidAction } from './antiRaidManager';

// Surfaces the reputation the bot ALREADY stores (RequestReview ratings,
// contributionScore) and manages the Verified Freelancer role. No new economy
// loops — read-mostly aggregation + one role grant gated behind mod approval.

const VERIFIED_KEY = 'verifiedrole';
const MIN_REVIEWS = 3; // leaderboard floor: ignore 1-review 5.0 gaming
let verifiedRoleIdCache: string | null = null;

// Create the verified role on startup if missing; persist its ID in
// ManagedChannel (config.ts is static). Reuses an existing role by id/name.
export async function ensureVerifiedRole(guild: Guild): Promise<void> {
    const saved = await prisma.managedChannel.findUnique({ where: { key: VERIFIED_KEY } }).catch(() => null);
    if (saved?.channelId && guild.roles.cache.has(saved.channelId)) {
        verifiedRoleIdCache = saved.channelId;
        return;
    }
    let role = guild.roles.cache.find(r => r.name === config.verifiedFreelancer.roleName);
    if (!role) {
        try {
            markInternalAntiRaidAction('roleCreate', '*');
            role = await guild.roles.create({
                name: config.verifiedFreelancer.roleName,
                color: config.verifiedFreelancer.color,
                reason: 'Stella Bot — Verified Freelancer role'
            });
        } catch (error) {
            console.error('Verified-role bootstrap: failed to create role:', error);
            return;
        }
    }
    verifiedRoleIdCache = role.id;
    await prisma.managedChannel.upsert({
        where: { key: VERIFIED_KEY },
        update: { channelId: role.id },
        create: { key: VERIFIED_KEY, channelId: role.id }
    }).catch(error => console.error('Verified-role bootstrap: persist failed:', error));
}

export async function resolveVerifiedRoleId(): Promise<string | null> {
    if (verifiedRoleIdCache) return verifiedRoleIdCache;
    const row = await prisma.managedChannel.findUnique({ where: { key: VERIFIED_KEY } }).catch(() => null);
    if (row?.channelId) verifiedRoleIdCache = row.channelId;
    return verifiedRoleIdCache;
}

// Grant the verified role to a member (called after a mod approves). Also flags
// the User so we don't re-prompt. Returns true on success.
export async function grantVerifiedRole(guild: Guild, userId: string): Promise<boolean> {
    const roleId = await resolveVerifiedRoleId();
    if (!roleId) return false;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return false;
    if (!member.roles.cache.has(roleId)) await member.roles.add(roleId).catch(() => {});
    await prisma.user.upsert({
        where: { id: userId },
        update: { verifiedAt: new Date() },
        create: { id: userId, verifiedAt: new Date() }
    }).catch(() => {});
    return true;
}

// Marks that a user has posted their first portfolio. Returns true only the FIRST
// time (so the mod-approval prompt fires once). Atomic-ish: updateMany gated on
// hasPortfolio=false so concurrent posts don't double-prompt.
export async function markFirstPortfolio(userId: string): Promise<boolean> {
    await prisma.user.upsert({ where: { id: userId }, update: {}, create: { id: userId } });
    const claimed = await prisma.user.updateMany({
        where: { id: userId, hasPortfolio: false },
        data: { hasPortfolio: true }
    });
    return claimed.count === 1;
}

// Persist a join timestamp so 7-day retention is computable. Idempotent: only
// sets joinedAt if not already set (first join wins; backfill-safe).
export async function recordJoin(userId: string): Promise<void> {
    await prisma.user.upsert({
        where: { id: userId },
        update: {},
        create: { id: userId, joinedAt: new Date() }
    });
    await prisma.user.updateMany({
        where: { id: userId, joinedAt: null },
        data: { joinedAt: new Date() }
    });
}

export interface FreelancerRank {
    userId: string;
    avgRating: number;
    jobCount: number;
}

// Leaderboard: aggregate RequestReview by targetId, floor at MIN_REVIEWS reviews
// to avoid a single-review 5.0 topping the board.
export async function getFreelancerLeaderboard(limit = 10): Promise<FreelancerRank[]> {
    const grouped = await prisma.requestReview.groupBy({
        by: ['targetId'],
        _avg: { rating: true },
        _count: { rating: true }
    });
    return grouped
        .filter(g => (g._count.rating ?? 0) >= MIN_REVIEWS)
        .map(g => ({ userId: g.targetId, avgRating: g._avg.rating ?? 0, jobCount: g._count.rating ?? 0 }))
        .sort((a, b) => b.avgRating - a.avgRating || b.jobCount - a.jobCount)
        .slice(0, limit);
}

// Per-user reputation for the profile embed. avgRating null when no reviews yet.
export async function getFreelancerStats(userId: string): Promise<{ avgRating: number | null; jobCount: number; verified: boolean }> {
    const agg = await prisma.requestReview.aggregate({
        where: { targetId: userId },
        _avg: { rating: true },
        _count: { rating: true }
    });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { verifiedAt: true } }).catch(() => null);
    const count = agg._count.rating ?? 0;
    return {
        avgRating: count > 0 ? (agg._avg.rating ?? 0) : null,
        jobCount: count,
        verified: !!user?.verifiedAt
    };
}
