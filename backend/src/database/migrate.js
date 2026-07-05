const fs = require('fs');
const path = require('path');
const { db } = require('../config/database');
const logger = require('../config/logger');

// In the repo this resolves to backend/database; in the Docker image, /app/database.
const SQL_ROOT = path.join(__dirname, '..', '..', 'database');

async function tableExists(name) {
  const row = await db.oneOrNone('SELECT to_regclass($1) AS reg', [`public.${name}`]);
  return Boolean(row && row.reg);
}

function listMigrationFiles() {
  const dir = path.join(SQL_ROOT, 'migrations');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

async function runMigrations() {
  await db.none(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  const rows = await db.manyOrNone('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.version));
  const files = listMigrationFiles();
  const usersExists = await tableExists('users');

  if (usersExists && applied.size === 0) {
    // Hand-managed database predating the runner: record everything as
    // applied without executing, so existing dev DBs are never re-migrated.
    await db.tx(async (tx) => {
      await tx.none('INSERT INTO schema_migrations (version) VALUES ($1)', ['000_init']);
      for (const f of files) {
        await tx.none('INSERT INTO schema_migrations (version) VALUES ($1)', [f]);
      }
    });
    logger.info('Baselined existing database; no migrations executed');
    return;
  }

  if (!usersExists && !applied.has('000_init')) {
    const initSql = fs.readFileSync(path.join(SQL_ROOT, 'init.sql'), 'utf8');
    await db.tx(async (tx) => {
      await tx.none(initSql);
      await tx.none('INSERT INTO schema_migrations (version) VALUES ($1)', ['000_init']);
    });
    applied.add('000_init');
    logger.info('Applied baseline init.sql');
  }

  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(SQL_ROOT, 'migrations', f), 'utf8');
    await db.tx(async (tx) => {
      await tx.none(sql);
      await tx.none('INSERT INTO schema_migrations (version) VALUES ($1)', [f]);
    });
    logger.info({ migration: f }, 'Applied migration');
  }
}

module.exports = { runMigrations };

if (require.main === module) {
  runMigrations()
    .then(() => {
      logger.info('Migrations complete');
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err: err.message }, 'Migration failed');
      process.exit(1);
    });
}
