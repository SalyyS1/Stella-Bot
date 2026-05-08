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

    const data = {};
    for (const table of tables) {
        data[table.name] = await prisma[table.client].findMany();
    }

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
