require('dotenv').config();

const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const {
    countAll,
    normalizeDates,
    parseArgs,
    resetSequences,
    resolveProjectPath,
    tables
} = require('./db-utils');

const args = parseArgs(process.argv.slice(2));
const file = args.file ? resolveProjectPath(args.file) : null;
const replace = Boolean(args.replace);
const prisma = new PrismaClient();

async function clearExistingData() {
    for (const table of [...tables].reverse()) {
        await prisma[table.client].deleteMany();
    }
}

async function restoreTable(table, rows) {
    let restored = 0;
    for (const raw of rows || []) {
        const row = normalizeDates(raw, table.dateFields);
        await prisma[table.client].upsert({
            where: table.key(row),
            update: row,
            create: row
        });
        restored++;
    }
    return restored;
}

async function main() {
    if (!process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith('file:')) {
        throw new Error('DATABASE_URL must point to PostgreSQL before restore.');
    }
    if (!file || !fs.existsSync(file)) {
        throw new Error('Usage: npm run db:restore -- --file backups/stella-backup-....json [--replace]');
    }

    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    const restored = {};

    if (replace) await clearExistingData();

    for (const table of tables) {
        restored[table.name] = await restoreTable(table, payload.tables?.[table.name] || []);
    }

    await resetSequences(prisma);
    const postgresCounts = await countAll(prisma);

    console.log(JSON.stringify({
        file,
        replace,
        restored,
        postgresCounts
    }, null, 2));
}

main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
