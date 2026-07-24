require('dotenv').config();

const fs = require('fs');
const Database = require('better-sqlite3');
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
const sqlitePath = resolveProjectPath(args.sqlite || 'prisma/data.db');
const prisma = new PrismaClient();

function readRows(db, table) {
    return db.prepare(`SELECT * FROM "${table.name}"`).all()
        .map(row => normalizeDates(row, table.dateFields));
}

async function importTable(table, rows) {
    if (rows.length === 0) return 0;
    const result = await prisma[table.client].createMany({
        data: rows,
        skipDuplicates: true
    });
    return result.count;
}

async function main() {
    if (!process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith('file:')) {
        throw new Error('DATABASE_URL must point to PostgreSQL before importing.');
    }
    if (!fs.existsSync(sqlitePath)) {
        throw new Error(`SQLite file not found: ${sqlitePath}`);
    }

    const db = new Database(sqlitePath, { readonly: true });
    const imported = {};

    for (const table of tables) {
        const rows = readRows(db, table);
        imported[table.name] = await importTable(table, rows);
    }

    await resetSequences(prisma);
    const postgresCounts = await countAll(prisma);

    console.log(JSON.stringify({
        sqlite: sqlitePath,
        imported,
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
