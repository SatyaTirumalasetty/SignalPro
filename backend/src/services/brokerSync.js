const cron = require('node-cron');
const { db } = require('../config/database');
const { decryptCredentials, encryptCredentials } = require('../config/brokerEncryption');
const { getAdapter } = require('./brokers/index');
const logger = require('../config/logger');

// ── Single connection sync ────────────────────────────────────────────────────

async function syncConnection(connectionId) {
  const conn = await db.oneOrNone(
    `SELECT id, user_id, broker_id, credentials_encrypted, status
     FROM broker_connections WHERE id = $1`,
    [connectionId]
  );
  if (!conn || conn.status === 'disconnected') return;

  const started = Date.now();
  try {
    const credentials = decryptCredentials(conn.credentials_encrypted);
    const adapter = getAdapter(conn.broker_id, credentials);
    const accountInfo = await adapter.getAccountInfo();

    await db.none(
      `UPDATE broker_connections
       SET account_info = $1, last_sync = CURRENT_TIMESTAMP, sync_error = NULL,
           status = 'connected', updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [JSON.stringify(accountInfo), conn.id]
    );

    await logSync(conn.id, 'account_info', 'success', 1, null, Date.now() - started);
  } catch (err) {
    await db.none(
      `UPDATE broker_connections
       SET sync_error = $1, status = 'error', updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [err.message, conn.id]
    );
    await logSync(conn.id, 'account_info', 'failed', 0, err.message, Date.now() - started);
    logger.warn({ connectionId, broker: conn.broker_id, err: err.message }, 'Broker sync failed');
  }
}

// ── Token refresh ─────────────────────────────────────────────────────────────

async function refreshExpiredTokens() {
  // Find connections whose token expires within the next 2 hours
  const connections = await db.manyOrNone(
    `SELECT id, broker_id, credentials_encrypted
     FROM broker_connections
     WHERE status IN ('connected', 'error')
       AND token_expires_at IS NOT NULL
       AND token_expires_at < CURRENT_TIMESTAMP + INTERVAL '2 hours'`
  );

  logger.info(`Token refresh: checking ${connections.length} connection(s)`);

  for (const conn of connections) {
    const started = Date.now();
    try {
      const credentials = decryptCredentials(conn.credentials_encrypted);
      const adapter = getAdapter(conn.broker_id, credentials);
      const updated = await adapter.refreshToken();

      if (updated) {
        const newExpiry = updated.expires_at || null;
        await db.none(
          `UPDATE broker_connections
           SET credentials_encrypted = $1, token_expires_at = $2,
               status = 'connected', sync_error = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [encryptCredentials(updated), newExpiry, conn.id]
        );
        await logSync(conn.id, 'token_refresh', 'success', 0, null, Date.now() - started);
        logger.info({ connectionId: conn.id, broker: conn.broker_id }, 'Token refreshed');
      } else {
        // Adapter returned null — token can't be refreshed automatically (e.g. Zerodha)
        await db.none(
          `UPDATE broker_connections SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [conn.id]
        );
        await logSync(conn.id, 'token_refresh', 'failed', 0, 'Token cannot be refreshed — re-auth required', Date.now() - started);
      }
    } catch (err) {
      await logSync(conn.id, 'token_refresh', 'failed', 0, err.message, Date.now() - started);
      logger.error({ connectionId: conn.id, err: err.message }, 'Token refresh error');
    }
  }
}

// ── Sync all active connections ───────────────────────────────────────────────

async function syncAllConnections() {
  const connections = await db.manyOrNone(
    `SELECT id FROM broker_connections WHERE status IN ('connected', 'error')`
  );
  logger.info(`Broker sync: syncing ${connections.length} connection(s)`);
  await Promise.allSettled(connections.map(c => syncConnection(c.id)));
}

// ── Audit helper ──────────────────────────────────────────────────────────────

async function logSync(connectionId, syncType, status, records, errorMessage, durationMs) {
  await db.none(
    `INSERT INTO broker_sync_logs (broker_connection_id, sync_type, status, records_synced, error_message, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [connectionId, syncType, status, records, errorMessage, durationMs]
  ).catch(() => {}); // non-fatal
}

// ── Cron jobs ─────────────────────────────────────────────────────────────────

function startCronJobs() {
  // Sync account info every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    logger.info('Cron: starting broker account sync');
    await syncAllConnections().catch(err => logger.error({ err }, 'Cron sync failed'));
  });

  // Refresh expiring tokens daily at midnight UTC
  cron.schedule('0 0 * * *', async () => {
    logger.info('Cron: starting token refresh');
    await refreshExpiredTokens().catch(err => logger.error({ err }, 'Cron token refresh failed'));
  });

  logger.info('Broker sync cron jobs started');
}

module.exports = { syncConnection, syncAllConnections, refreshExpiredTokens, startCronJobs };
