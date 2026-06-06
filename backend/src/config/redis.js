const { createClient } = require('redis');
const logger = require('./logger');

let client = null;

async function getRedisClient() {
  if (client && client.isReady) return client;

  if (!process.env.REDIS_URL) {
    return null; // Redis optional — callers fall back to in-process
  }

  try {
    client = createClient({ url: process.env.REDIS_URL });
    client.on('error', err => logger.warn({ err: err.message }, 'Redis client error'));
    await client.connect();
    logger.info('Redis connected');
    return client;
  } catch (err) {
    logger.warn({ err: err.message }, 'Redis unavailable — running without cache');
    client = null;
    return null;
  }
}

async function cacheGet(key) {
  const r = await getRedisClient();
  if (!r) return null;
  try {
    const val = await r.get(key);
    return val ? JSON.parse(val) : null;
  } catch { return null; }
}

async function cacheSet(key, value, ttlSeconds = 300) {
  const r = await getRedisClient();
  if (!r) return;
  try {
    await r.set(key, JSON.stringify(value), { EX: ttlSeconds });
  } catch { /* non-fatal */ }
}

async function cacheDel(key) {
  const r = await getRedisClient();
  if (!r) return;
  try { await r.del(key); } catch { /* non-fatal */ }
}

module.exports = { getRedisClient, cacheGet, cacheSet, cacheDel };
