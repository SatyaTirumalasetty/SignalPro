const pgPromise = require('pg-promise');
const logger = require('./logger');

const pgp = pgPromise({
  capSQL: true,
});

const db = pgp({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'signalpro',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: parseInt(process.env.DB_POOL_MAX) || 20,
  min: parseInt(process.env.DB_POOL_MIN) || 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function initializeDatabase() {
  try {
    const result = await db.one('SELECT NOW() as time, version() as version');
    logger.info('✅ Database connection verified', result);
    return true;
  } catch (error) {
    logger.error('❌ Database connection failed:', error.message);
    throw error;
  }
}

module.exports = { db, pgp, initializeDatabase };
