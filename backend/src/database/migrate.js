require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { db } = require('../config/database');
const logger = require('../config/logger');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', '..', 'database', 'migrations');

async function ensureMigrationsTable() {
  await db.none(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations() {
  const rows = await db.any('SELECT filename FROM schema_migrations');
  return new Set(rows.map((row) => row.filename));
}

async function applyMigration(filename) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
  await db.tx(async (t) => {
    await t.none(sql);
    await t.none('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
  });
}

async function migrate() {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  const pending = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((filename) => filename.endsWith('.sql'))
    .sort()
    .filter((filename) => !applied.has(filename));

  if (pending.length === 0) {
    logger.info('✅ No pending migrations — database is up to date');
    return;
  }

  for (const filename of pending) {
    logger.info(`▶ Applying migration ${filename}`);
    await applyMigration(filename);
    logger.info(`✅ Applied ${filename}`);
  }

  logger.info(`✅ Applied ${pending.length} migration(s)`);
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error('❌ Migration failed:', error.message);
    process.exit(1);
  });
