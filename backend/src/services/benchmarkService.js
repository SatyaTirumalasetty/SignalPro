// Daily snapshot of engine equity vs an equal-weight buy-and-hold of the
// watchlist, frozen at the first snapshot. Success criterion for the paper
// trial: the engine line beats the buy-and-hold line.

const cron = require('node-cron');
const { db } = require('../config/database');
const { decryptCredentials } = require('../config/brokerEncryption');
const { getAdapter } = require('./brokers/index');
const { getCurrentPrice } = require('./marketData');
const { getAutoTradingSettings } = require('./autoTradingEngine');
const logger = require('../config/logger');

async function snapshotUser(user) {
  const settings = getAutoTradingSettings(user.preferences);
  if (!settings.enabled || !settings.broker_connection_id || !settings.symbols.length) return;

  const conn = await db.oneOrNone(
    `SELECT id, broker_id, credentials_encrypted FROM broker_connections
     WHERE id = $1 AND user_id = $2 AND status = 'connected'`,
    [settings.broker_connection_id, user.id]
  );
  if (!conn) return;

  const adapter = getAdapter(conn.broker_id, decryptCredentials(conn.credentials_encrypted));
  const account = await adapter.getAccountInfo();
  const equity = account?.funds?.equity;
  if (!equity) return;

  const first = await db.oneOrNone(
    `SELECT watchlist_composition FROM benchmark_snapshots
     WHERE user_id = $1 ORDER BY snapshot_date ASC LIMIT 1`,
    [user.id]
  );

  let composition = first?.watchlist_composition || null;
  const symbols = composition ? Object.keys(composition) : settings.symbols;

  const prices = {};
  for (const symbol of symbols) {
    prices[symbol] = (await getCurrentPrice(symbol)).price;
  }

  if (!composition) {
    // Freeze an equal-dollar-weight buy-and-hold of today's watchlist at
    // today's prices. Fractional shares are fine — it's a benchmark.
    composition = {};
    const perSymbol = equity / symbols.length;
    for (const symbol of symbols) {
      composition[symbol] = +(perSymbol / prices[symbol]).toFixed(6);
    }
  }

  const watchlistValue = Object.entries(composition)
    .reduce((sum, [symbol, qty]) => sum + qty * (prices[symbol] || 0), 0);

  await db.none(
    `INSERT INTO benchmark_snapshots (user_id, engine_equity, watchlist_value, watchlist_composition, snapshot_date)
     VALUES ($1, $2, $3, $4, CURRENT_DATE)
     ON CONFLICT (user_id, snapshot_date) DO NOTHING`,
    [user.id, equity, +watchlistValue.toFixed(2), JSON.stringify(composition)]
  );
  logger.info({ userId: user.id, equity, watchlistValue: +watchlistValue.toFixed(2) }, 'Benchmark snapshot recorded');
}

async function runBenchmarkSnapshots() {
  const users = await db.manyOrNone(
    `SELECT id, email, preferences FROM users WHERE preferences->'auto_trading'->>'enabled' = 'true'`
  );
  await Promise.allSettled(users.map((u) =>
    snapshotUser(u).catch((err) =>
      logger.error({ userId: u.id, err: err.message }, 'Benchmark snapshot failed')
    )
  ));
}

function startBenchmarkCron() {
  // Weekdays 21:10 UTC — after the US market close, staggered off other crons.
  cron.schedule('10 21 * * 1-5', async () => {
    logger.info('Cron: benchmark snapshots');
    await runBenchmarkSnapshots().catch((err) => logger.error({ err }, 'Benchmark snapshot run failed'));
  });
  logger.info('Benchmark cron job started');
}

module.exports = { snapshotUser, runBenchmarkSnapshots, startBenchmarkCron };
