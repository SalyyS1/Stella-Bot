require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const { countAll } = require('./db-utils');

const prisma = new PrismaClient();

async function main() {
    if (!process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith('file:')) {
        throw new Error('DATABASE_URL must point to PostgreSQL before verify.');
    }
    console.log(JSON.stringify(await countAll(prisma), null, 2));
}

main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
