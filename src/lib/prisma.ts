import { PrismaClient } from '@prisma/client';

if (!process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith('file:')) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection string. Update .env to the Neon DATABASE_URL before starting Stella Bot.');
}

// Trần số connection mà process này được mở.
//
// Pooler Supabase đang chạy ở SESSION MODE (cổng 5432): mỗi client giữ riêng một backend
// Postgres trong suốt phiên và cả project chỉ được 15 client. Prisma không thấy trần trong
// URL thì tự lấy `physical_cpus * 2 + 1` rồi giữ số connection đó ở trạng thái idle mãi.
// Đo trên DB thật ngày 29/8/2026: 14 idle + 1 = 15/15 — không còn slot nào cho migration,
// cho `scripts/backup-db.js`, hay cho lần chạy thử ở máy dev. Bot một mình làm đầy pooler.
//
// Ngân sách 15 slot: 10 cho process bot (panel dùng chung client này nên nằm trong 10),
// chừa 5 cho script bảo trì và máy dev. Panel còn trần riêng 4 truy vấn song song
// (`src/panel/data/query-limit.ts`) để một request dashboard không chiếm hết phần của bot.
const DEFAULT_CONNECTION_LIMIT = 10;
const POOLER_MAX_CLIENTS = 15;

function resolveDatabaseUrl(raw: string): string {
    const requested = Number(process.env.DB_CONNECTION_LIMIT) || DEFAULT_CONNECTION_LIMIT;
    const limit = Math.max(1, Math.min(requested, POOLER_MAX_CLIENTS));
    try {
        const url = new URL(raw);
        // Không ghi đè khi URL đã tự khai: người vận hành biết rõ hơn file này.
        if (!url.searchParams.has('connection_limit')) {
            url.searchParams.set('connection_limit', String(limit));
        }
        return url.toString();
    } catch {
        // URL không parse được thì trả nguyên văn: thà chạy với mặc định của Prisma còn hơn
        // không kết nối được. Lỗi thật sẽ hiện ra khi Prisma tự validate.
        return raw;
    }
}

// Higher default transaction timeout: the DB (Supabase, Singapore) has higher
// round-trip latency than the old Neon setup, so multi-query interactive
// transactions (daily, giveaway, star sell, vote self-heal) were tripping the
// 5s default. Raising it here applies to every $transaction call at once
// instead of patching each site. maxWait = how long to wait for a connection.
const prisma = new PrismaClient({
    datasourceUrl: resolveDatabaseUrl(process.env.DATABASE_URL),
    transactionOptions: {
        maxWait: 10_000,
        timeout: 20_000
    }
});

export default prisma;
