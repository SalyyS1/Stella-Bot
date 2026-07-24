require('dotenv').config();

const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const {
    ensureDir,
    resolveProjectPath,
    serializeRows,
    tables,
    timestampName
} = require('./db-utils');

const prisma = new PrismaClient();

async function main() {
    if (!process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith('file:')) {
        throw new Error('DATABASE_URL must point to PostgreSQL before backup.');
    }

    const backupDir = resolveProjectPath('backups');
    ensureDir(backupDir);

    const data = await prisma.$transaction(async tx => {
        const snapshot = {};
        for (const table of tables) {
            snapshot[table.name] = await tx[table.client].findMany();
        }
        return snapshot;
    }, {
        isolationLevel: 'RepeatableRead',
        maxWait: 10_000,
        timeout: 5 * 60_000
    });

    const file = resolveProjectPath('backups', `stella-backup-${timestampName()}.json`);
    fs.writeFileSync(file, serializeRows(data));
    console.log(file);
}

main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
