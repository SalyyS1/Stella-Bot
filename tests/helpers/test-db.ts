import { Client } from 'discord.js';
import prisma from '../../src/lib/prisma';

// Positive opt-in marker. truncateAll() refuses to run unless this table
// exists on the connected database. A production DB will never have it, so a
// mis-pointed DATABASE_URL_TEST can wipe nothing. String inequality to
// DATABASE_URL is kept only as a secondary, weaker guard (Neon exposes the same
// physical DB via multiple non-equal connection strings, so equality alone is
// not proof of a different database).
const MARKER_TABLE = '__stella_test_db';

// Tables truncated between tests. Order does not matter with CASCADE.
const TABLES = [
    'ScoinTransaction',
    'RequestReview',
    'RequestClaim',
    'RequestPost',
    'GiveawayRewardDelivery',
    'GiveawayEntry',
    'Giveaway',
    'StarHarvestSession',
    'StarBuff',
    'StarTool',
    'StarItemStack',
    'StarInventory',
    'MusicPlaylistTrack',
    'ShowcasePost',
    'Vote',
    'MaintenanceLog',
    'ManagedChannel',
    'Blacklist',
    'GuildSettings',
    'User'
];

function requireTestDatabaseUrl(): string {
    const testUrl = process.env.DATABASE_URL_TEST;
    if (!testUrl) {
        throw new Error(
            'DATABASE_URL_TEST is not set. Point it at an ISOLATED scratch database ' +
            '(a Neon branch or local Postgres) — NEVER the production DATABASE_URL.'
        );
    }
    if (testUrl === process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL_TEST must not equal DATABASE_URL (refusing to run against prod).');
    }
    return testUrl;
}

// Creates the opt-in marker table. Run this ONCE against a scratch DB to bless
// it for testing. Safe to call repeatedly (IF NOT EXISTS).
export async function ensureTestMarker(): Promise<void> {
    requireTestDatabaseUrl();
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "${MARKER_TABLE}" (id int primary key)`);
}

async function assertMarkerPresent(): Promise<void> {
    requireTestDatabaseUrl();
    const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
        `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '${MARKER_TABLE}') AS "exists"`
    );
    if (!rows[0]?.exists) {
        throw new Error(
            `Test-DB marker "${MARKER_TABLE}" is absent. Refusing to truncate — this may be a real database. ` +
            'Run ensureTestMarker() against a scratch DB first.'
        );
    }
}

// Wipes all app tables. HARD-GATED behind the marker check above.
export async function truncateAll(): Promise<void> {
    await assertMarkerPresent();
    const quoted = TABLES.map(t => `"${t}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
}

export async function seedUser(id: string, scoinBalance = 0): Promise<void> {
    await prisma.user.upsert({
        where: { id },
        update: { scoinBalance },
        create: { id, scoinBalance }
    });
}

export async function getUser(id: string) {
    return prisma.user.findUniqueOrThrow({ where: { id } });
}

export async function countTransactions(source: string): Promise<number> {
    return prisma.scoinTransaction.count({ where: { source } });
}

export async function disconnect(): Promise<void> {
    await prisma.$disconnect();
}

// Minimal Discord Client stub. The money-path functions call client.channels.fetch()
// (for message refresh / admin log); returning null makes those no-op safely.
export function stubClient(): Client {
    return {
        channels: { fetch: async () => null }
    } as unknown as Client;
}

export { prisma };
