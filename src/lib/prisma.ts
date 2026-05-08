import { PrismaClient } from '@prisma/client';

if (!process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith('file:')) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection string. Update .env to the Neon DATABASE_URL before starting Stella Bot.');
}

const prisma = new PrismaClient();

export default prisma;
