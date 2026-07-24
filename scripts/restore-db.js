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

function validatePayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !payload.tables || typeof payload.tables !== 'object' || Array.isArray(payload.tables)) {
        throw new Error('Backup payload must contain a tables object.');
    }
    for (const table of tables) {
        const rows = payload.tables[table.name];
        if (replace && rows === undefined) {
            throw new Error(`Replace restore requires backup table ${table.name}.`);
        }
        if (rows !== undefined && (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row)))) {
            throw new Error(`Backup table ${table.name} must be an array of objects.`);
        }
    }
}

async function clearExistingData(client) {
    for (const table of [...tables].reverse()) {
        await client[table.client].deleteMany();
    }
}

async function restoreTable(client, table, rows) {
    let restored = 0;
    for (const raw of rows || []) {
        const row = normalizeDates(raw, table.dateFields);
        await client[table.client].upsert({
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
    validatePayload(payload);

    const restored = await prisma.$transaction(async tx => {
        const counts = {};
        if (replace) await clearExistingData(tx);
        for (const table of tables) {
            counts[table.name] = await restoreTable(tx, table, payload.tables[table.name] || []);
        }
        await resetSequences(tx);
        return counts;
    }, {
        maxWait: 10_000,
        timeout: 10 * 60_000
    });
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
