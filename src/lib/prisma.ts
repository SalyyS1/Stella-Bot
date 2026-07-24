import { PrismaClient } from '@prisma/client';

if (!process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith('file:')) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection string. Update .env to the Neon DATABASE_URL before starting Stella Bot.');
}

// Higher default transaction timeout: the DB (Supabase, Singapore) has higher
// round-trip latency than the old Neon setup, so multi-query interactive
// transactions (daily, giveaway, star sell, vote self-heal) were tripping the
// 5s default. Raising it here applies to every $transaction call at once
// instead of patching each site. maxWait = how long to wait for a connection.
const prisma = new PrismaClient({
    transactionOptions: {
        maxWait: 10_000,
        timeout: 20_000
    }
});

export default prisma;
