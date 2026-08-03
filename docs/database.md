# Stella Bot Cloud Database

Stella Bot uses Prisma with PostgreSQL. Neon is the recommended hosted database.

## First setup

1. Create a Neon PostgreSQL project.
2. Copy the pooled or direct connection string.
3. Set `.env`:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST.neon.tech/DBNAME?sslmode=require"
```

4. Apply the schema:

```bash
npm run db:migrate
```

5. Import the old local SQLite data once:

```bash
npm run db:import:sqlite -- --sqlite prisma/data.db
```

6. Verify row counts:

```bash
npm run db:verify
```

After this, the cloud database is the source of truth. Do not run the bot against `prisma/data.db` anymore unless intentionally restoring old local data.

## Backup and restore

Create a local JSON backup:

```bash
npm run db:backup
```

Restore into the configured PostgreSQL database:

```bash
npm run db:restore -- --file backups/stella-backup-YYYY-MM-DD.json
```

Use `--replace` only when restoring into a clean/test database or when you intentionally want to delete existing cloud rows first:

```bash
npm run db:restore -- --file backups/stella-backup-YYYY-MM-DD.json --replace
```

## Report tables

`ReportChunk` holds the intermediate 3-hour summaries (`period` + `slot` unique). They are pruned after `config.report.chunk.retentionDays` (7) days and are not a finished report.

`ReportDaily` holds the finished daily report that was actually posted, so the Sunday weekly digest (`report-weekly`) can read the past days back. Chunks cannot serve that purpose: they expire after 7 days and are raw per-slot notes, not the composed bulletin.

| Column | Notes |
| --- | --- |
| `period` | day key `yyyy-MM-dd` in `config.maintenance.timezone`, unique (one row per day) |
| `body` | the posted report text |
| `createdAt` | insert time |

Migration: `prisma/migrations/20260803190000_report_daily`. Rows older than 35 days are pruned (`pruneOldDailyReports` in `src/systems/report/report-daily-store.ts`) — one row per day, so growth is negligible.

## Runtime note

Only run one live Stella Bot instance at a time. Multiple instances can connect to the same cloud database, but Discord events may be processed more than once.
