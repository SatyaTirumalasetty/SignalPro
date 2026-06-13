// Autonomous trading engine: periodically analyzes each opted-in user's
// watchlist with the AI signal pipeline and places real orders through
// their connected broker, subject to the same risk management used for
// manual orders.

const cron = require('node-cron');
const { db } = require('../config/database');
const { decryptCredentials } = require('../config/brokerEncryption');
const { getAdapter } = require('./brokers/index');
const { getHistoricalData } = require('./marketData');
const { calculateAll } = require('./indicators');
const { getNews } = require('./alpacaMarketData');
const { generateSignal } = require('./aiAnalysis');
const riskManagement = require('./riskManagement');
const { placeOrder } = require('./orderExecution');
const logger = require('../config/logger');

const DEFAULT_SETTINGS = {
  enabled: false,
  broker_connection_id: null,
  symbols: [],
  timeframes: ['1h'],
  min_confidence: 70,
  risk_per_trade_pct: riskManagement.DEFAULT_RISK_PER_TRADE_PCT,
  max_daily_loss_pct: riskManagement.DEFAULT_MAX_DAILY_LOSS_PCT,
  cooldown_minutes: 60,
  max_trades_per_day: 5,
};

function getAutoTradingSettings(preferences) {
  return { ...DEFAULT_SETTINGS, ...(preferences?.auto_trading || {}) };
}

// ── Cycle entry point ─────────────────────────────────────────────────────────

async function runAutoTradingCycle() {
  if (process.env.AUTO_TRADING_ENABLED === 'false') {
    logger.info('Auto-trading disabled via AUTO_TRADING_ENABLED env var — skipping cycle');
    return;
  }

  const users = await db.manyOrNone(
    `SELECT id, preferences FROM users WHERE preferences->'auto_trading'->>'enabled' = 'true'`
  );

  logger.info(`Auto-trading: running cycle for ${users.length} user(s)`);
  await Promise.allSettled(users.map((u) => runForUser(u.id, getAutoTradingSettings(u.preferences))));
}

async function runForUser(userId, settings) {
  if (!settings.broker_connection_id || !settings.symbols?.length) return;

  const conn = await db.oneOrNone(
    `SELECT id, broker_id, credentials_encrypted FROM broker_connections
     WHERE id = $1 AND user_id = $2 AND status = 'connected'`,
    [settings.broker_connection_id, userId]
  );
  if (!conn) return;

  for (const symbol of settings.symbols) {
    for (const timeframe of settings.timeframes) {
      try {
        await analyzeAndTrade(userId, settings, conn, symbol, timeframe);
      } catch (err) {
        logger.error({ userId, symbol, timeframe, err: err.message }, 'Auto-trading cycle error');
        await logRun({ userId, symbol, timeframe, action: 'error', errorMessage: err.message });
      }
    }
  }
}

// ── Per symbol/timeframe decision ───────────────────────────────────────────────

async function analyzeAndTrade(userId, settings, conn, symbol, timeframe) {
  const cooldownRow = await db.oneOrNone(
    `SELECT id FROM auto_trading_runs
     WHERE user_id = $1 AND symbol = $2 AND action = 'order_placed'
       AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 minute' * $3
     ORDER BY created_at DESC LIMIT 1`,
    [userId, symbol, settings.cooldown_minutes]
  );
  if (cooldownRow) {
    return logRun({ userId, symbol, timeframe, action: 'skipped_cooldown' });
  }

  const { count } = await db.one(
    `SELECT COUNT(*) FROM auto_trading_runs
     WHERE user_id = $1 AND action = 'order_placed' AND created_at >= CURRENT_DATE`,
    [userId]
  );
  if (parseInt(count, 10) >= settings.max_trades_per_day) {
    return logRun({ userId, symbol, timeframe, action: 'skipped_daily_trade_limit' });
  }

  const histData = await getHistoricalData(symbol, timeframe, 250);
  if (!histData.candles.length) {
    return logRun({ userId, symbol, timeframe, action: 'error', errorMessage: `No market data available for ${symbol}` });
  }

  const indicators = calculateAll(histData.candles);
  const news = await getNews([symbol], 5);
  const signal = await generateSignal(userId, symbol, timeframe, histData, indicators, news);

  if (signal.signal === 'hold' || signal.confidence < settings.min_confidence) {
    return logRun({
      userId, symbol, timeframe, decision: signal.signal, confidence: signal.confidence,
      action: 'skipped_low_confidence', signalId: signal.id, reasoning: signal.reasoning,
    });
  }

  const positionType = signal.signal === 'buy' ? 'long' : 'short';
  const existing = await db.oneOrNone(
    `SELECT id FROM positions WHERE user_id = $1 AND symbol = $2 AND status = 'open' AND position_type = $3`,
    [userId, symbol, positionType]
  );
  if (existing) {
    return logRun({
      userId, symbol, timeframe, decision: signal.signal, confidence: signal.confidence,
      action: 'skipped_existing_position', signalId: signal.id, reasoning: signal.reasoning,
    });
  }

  let equity;
  try {
    const credentials = decryptCredentials(conn.credentials_encrypted);
    const adapter = getAdapter(conn.broker_id, credentials);
    const account = await adapter.getAccountInfo();
    equity = account?.funds?.equity;

    await riskManagement.checkDailyLossLimit({ db, userId, equity, maxDailyLossPct: settings.max_daily_loss_pct });
  } catch (err) {
    if (err.code === 'RISK_LIMIT_EXCEEDED') {
      return logRun({
        userId, symbol, timeframe, decision: signal.signal, confidence: signal.confidence,
        action: 'skipped_daily_loss_limit', signalId: signal.id, reasoning: signal.reasoning,
      });
    }
    return logRun({
      userId, symbol, timeframe, decision: signal.signal, confidence: signal.confidence,
      action: 'error', signalId: signal.id, reasoning: signal.reasoning, errorMessage: err.message,
    });
  }

  const quantity = riskManagement.calculatePositionSize({
    equity, riskPerTradePct: settings.risk_per_trade_pct, entryPrice: signal.entry_price, stopLoss: signal.stop_loss,
  });
  if (quantity <= 0) {
    return logRun({
      userId, symbol, timeframe, decision: signal.signal, confidence: signal.confidence,
      action: 'skipped_risk_sizing', signalId: signal.id, reasoning: signal.reasoning,
    });
  }

  const order = await placeOrder({
    userId, brokerConnectionId: conn.id, conn, symbol, side: signal.signal, orderType: 'market',
    quantity, price: signal.entry_price, stopLoss: signal.stop_loss, takeProfit: signal.take_profit,
    signalId: signal.id, source: 'auto_engine',
  });

  return logRun({
    userId, symbol, timeframe, decision: signal.signal, confidence: signal.confidence,
    action: 'order_placed', signalId: signal.id, orderId: order.id, reasoning: signal.reasoning,
  });
}

async function logRun({ userId, symbol, timeframe, decision, confidence, action, signalId, orderId, reasoning, errorMessage }) {
  await db.none(
    `INSERT INTO auto_trading_runs (user_id, symbol, timeframe, decision, confidence, action, signal_id, order_id, reasoning, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [userId, symbol, timeframe, decision || null, confidence ?? null, action, signalId || null, orderId || null, reasoning || null, errorMessage || null]
  ).catch((err) => logger.error({ err: err.message }, 'Failed to log auto-trading run'));
}

// ── Cron job ─────────────────────────────────────────────────────────────────

function startAutoTradingCron() {
  // Staggered off the broker-sync `*/15 * * * *` schedule
  cron.schedule('7,22,37,52 * * * *', async () => {
    logger.info('Cron: starting auto-trading cycle');
    await runAutoTradingCycle().catch((err) => logger.error({ err }, 'Auto-trading cycle failed'));
  });

  logger.info('Auto-trading cron job started');
}

module.exports = {
  runAutoTradingCycle, startAutoTradingCron, getAutoTradingSettings, DEFAULT_SETTINGS,
  runForUser, analyzeAndTrade,
};
