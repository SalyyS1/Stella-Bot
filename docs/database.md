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

## Runtime note

Only run one live Stella Bot instance at a time. Multiple instances can connect to the same cloud database, but Discord events may be processed more than once.
