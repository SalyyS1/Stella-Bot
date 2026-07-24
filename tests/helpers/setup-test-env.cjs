// Runs via `node --require` BEFORE any TypeScript / Prisma import so the Prisma
// singleton in src/lib/prisma.ts connects to the scratch test DB, not prod.
// src/lib/prisma.ts reads DATABASE_URL (schema datasource env), so we must
// remap it here — validating first that test and prod are distinct.

// Tests do not boot index.ts, so load .env ourselves to see DATABASE_URL_TEST.
require('dotenv').config();

const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) {
    throw new Error(
        'DATABASE_URL_TEST is not set. Point it at an ISOLATED scratch database ' +
        '(a Neon branch or local Postgres) — NEVER the production DATABASE_URL.'
    );
}
if (process.env.DATABASE_URL && testUrl === process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL_TEST must not equal DATABASE_URL (refusing to run tests against prod).');
}
// From here on, every Prisma client in this process talks to the test DB.
process.env.DATABASE_URL = testUrl;

// The project tsconfig sets rootDir: ./src, so ts-node's type-checker would
// reject test files that live outside src/ (TS6059). Transpile-only skips that
// check — tests are run, not type-gated, and `npm run build` still type-checks src.
process.env.TS_NODE_TRANSPILE_ONLY = '1';
