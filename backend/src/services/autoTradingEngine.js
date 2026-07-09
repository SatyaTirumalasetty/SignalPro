// Autonomous trading engine v2: each cycle fuses multi-timeframe data per
// symbol into ONE Claude decision (entry, exit, or adjustment), then runs it
// through deterministic guardrails before touching the broker.
// Claude proposes; code disposes.

const cron = require('node-cron');
const { db } = require('../config/database');
const { decryptCredentials } = require('../config/brokerEncryption');
const { getAdapter } = require('./brokers/index');
const { buildMarketContext, buildScreeningSummaries } = require('./marketContext');
const { generateDecision, screenSymbols } = require('./aiAnalysis');
const { resolveAiMode } = require('./aiModes');
const { ENTRY_ACTIONS } = require('./decisionSchema');
const riskManagement = require('./riskManagement');
const { executeDecision } = require('./engineActions');
const {
  sendAutoTradingDailyLossLimitEmail,
  sendAutoTradingDisabledEmail,
} = require('./emailService');
const logger = require('../config/logger');

// If a user's last N runs all errored out, auto-trading is disabled for that
// user so a persistent failure doesn't loop forever without anyone noticing.
const CIRCUIT_BREAKER_ERROR_THRESHOLD = 5;

// In-memory dedupe so the daily-loss-limit email is sent at most once per
// user per day.
const dailyLossLimitNotified = new Map();

function shouldNotifyDailyLossLimit(userId) {
  const today = new Date().toISOString().slice(0, 10);
  if (dailyLossLimitNotified.get(userId) === today) return false;
  dailyLossLimitNotified.set(userId, today);
  return true;
}

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
  ai_mode: 'balanced',
  authority: { ...riskManagement.DEFAULT_AUTHORITY },
};

function getAutoTradingSettings(preferences) {
  const stored = preferences?.auto_trading || {};
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    authority: { ...riskManagement.DEFAULT_AUTHORITY, ...(stored.authority || {}) },
  };
}

// ── Cycle entry point ─────────────────────────────────────────────────────────

async function runAutoTradingCycle() {
  if (process.env.AUTO_TRADING_ENABLED === 'false') {
    logger.info('Auto-trading disabled via AUTO_TRADING_ENABLED env var — skipping cycle');
    return;
  }

  const users = await db.manyOrNone(
    `SELECT id, email, preferences FROM users WHERE preferences->'auto_trading'->>'enabled' = 'true'`
  );

  logger.info(`Auto-trading: running cycle for ${users.length} user(s)`);
  await Promise.allSettled(users.map((u) => runForUser(u.id, getAutoTradingSettings(u.preferences), u.email)));
}

async function checkCircuitBreaker(userId) {
  const recent = (await db.manyOrNone(
    `SELECT action FROM auto_trading_runs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, CIRCUIT_BREAKER_ERROR_THRESHOLD]
  )) || [];
  return recent.length === CIRCUIT_BREAKER_ERROR_THRESHOLD && recent.every((r) => r.action === 'error');
}

async function disableAutoTrading(userId, settings) {
  const merged = { ...settings, enabled: false };
  await db.none(
    `UPDATE users
     SET preferences = jsonb_set(COALESCE(preferences, '{}'::jsonb), '{auto_trading}', $1::jsonb),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [JSON.stringify(merged), userId]
  );
}

// ── Per-user cycle ────────────────────────────────────────────────────────────

async function runForUser(userId, settings, userEmail) {
  if (!settings.broker_connection_id) return;

  if (await checkCircuitBreaker(userId)) {
    await disableAutoTrading(userId, settings);
    await logRun({ userId, symbol: 'ALL', timeframe: '-', action: 'auto_disabled_errors' });
    if (userEmail) {
      await Promise.resolve(sendAutoTradingDisabledEmail(userEmail)).catch((err) =>
        logger.error({ userId, err: err.message }, 'Failed to send auto-trading disabled email')
      );
    }
    return;
  }

  const conn = await db.oneOrNone(
    `SELECT id, broker_id, credentials_encrypted FROM broker_connections
     WHERE id = $1 AND user_id = $2 AND status = 'connected'`,
    [settings.broker_connection_id, userId]
  );
  if (!conn) return;

  let adapter;
  try {
    adapter = getAdapter(conn.broker_id, decryptCredentials(conn.credentials_encrypted));
  } catch (err) {
    return logRun({ userId, symbol: 'ALL', timeframe: '-', action: 'error', errorMessage: `broker adapter: ${err.message}` });
  }

  // Positions are ground truth from the broker. If we can't see them we can
  // neither open safely nor manage what exists — skip the whole cycle.
  let brokerPositions;
  try {
    brokerPositions = await adapter.getPositions();
  } catch (err) {
    return logRun({ userId, symbol: 'ALL', timeframe: '-', action: 'error', errorMessage: `positions fetch failed: ${err.message}` });
  }
  const positionsBySymbol = new Map(brokerPositions.map((p) => [p.symbol, p]));

  // Entry gate: fail closed for entries, fail safe for exits. entryBlocked is
  // an action string used to log why entries were blocked this cycle.
  let equity = null;
  let entryBlocked = null;
  try {
    const account = await adapter.getAccountInfo();
    equity = account?.funds?.equity;
    await riskManagement.checkDailyLossLimit({ db, userId, equity, maxDailyLossPct: settings.max_daily_loss_pct });
  } catch (err) {
    if (err.code === 'RISK_LIMIT_EXCEEDED') {
      entryBlocked = 'skipped_daily_loss_limit';
      if (userEmail && shouldNotifyDailyLossLimit(userId)) {
        await Promise.resolve(sendAutoTradingDailyLossLimitEmail(userEmail)).catch((emailErr) =>
          logger.error({ userId, err: emailErr.message }, 'Failed to send daily loss limit email')
        );
      }
    } else {
      entryBlocked = 'skipped_entry_blocked';
      logger.warn({ userId, err: err.message }, 'Entry guardrails unavailable — blocking entries this cycle');
    }
  }

  const { realized_pnl } = await db.one(
    `SELECT COALESCE(SUM(pnl), 0) as realized_pnl FROM positions
     WHERE user_id = $1 AND status = 'closed' AND closed_at >= CURRENT_DATE`,
    [userId]
  ).catch(() => ({ realized_pnl: 0 }));

  const portfolio = {
    equity,
    open_positions: brokerPositions.length,
    exposure_pct: equity
      ? +(((brokerPositions.reduce((s, p) => s + (p.market_value || 0), 0)) / equity) * 100).toFixed(1)
      : null,
    todays_realized_pnl: parseFloat(realized_pnl) || 0,
  };

  // Universe: watchlist ∪ symbols with open positions, so a de-watchlisted
  // symbol keeps being managed until its position closes.
  const universe = [...new Set([...settings.symbols, ...positionsBySymbol.keys()])];
  const mode = resolveAiMode(settings.ai_mode);

  // Tiered mode: cheap screening pass picks candidates. Open positions always
  // pass. Screening failure fails OPEN to analysis (never to trading).
  let toAnalyze = universe;
  if (mode.screeningModel && universe.length) {
    try {
      const { summaries, unscreenable } = await buildScreeningSummaries(universe, positionsBySymbol);
      const picked = new Set(await screenSymbols(summaries, mode));
      toAnalyze = universe.filter(
        (s) => positionsBySymbol.has(s) || picked.has(s) || unscreenable.includes(s)
      );
      for (const symbol of universe.filter((s) => !toAnalyze.includes(s))) {
        await logRun({ userId, symbol, timeframe: '-', action: 'screened_out' });
      }
    } catch (err) {
      logger.warn({ userId, err: err.message }, 'Screening failed — analyzing all symbols');
    }
  }

  for (const symbol of toAnalyze) {
    try {
      await processSymbol({
        userId, userEmail, settings, conn, adapter, mode, symbol,
        position: positionsBySymbol.get(symbol) || null,
        portfolio, entryBlocked, equity,
      });
    } catch (err) {
      logger.error({ userId, symbol, err: err.message }, 'Auto-trading cycle error');
      await logRun({ userId, symbol, timeframe: settings.timeframes.join('+'), action: 'error', errorMessage: err.message });
    }
  }
}

// ── Per-symbol decision + guardrail gate ──────────────────────────────────────

async function processSymbol({
  userId, userEmail, settings, conn, adapter, mode, symbol, position, portfolio, entryBlocked, equity,
}) {
  const timeframeLabel = settings.timeframes.join('+');
  const context = await buildMarketContext({
    symbol, timeframes: settings.timeframes, contextProfile: mode.contextProfile, position, portfolio,
  });
  const decision = await generateDecision(userId, context, mode);

  const base = {
    userId, symbol, timeframe: timeframeLabel,
    decision: decision.action, confidence: decision.confidence,
    signalId: decision.id, reasoning: decision.reasoning,
    actionDetail: { decision },
  };

  if (decision.action === 'hold') return logRun({ ...base, action: 'hold' });

  if (decision.confidence < settings.min_confidence) {
    return logRun({ ...base, action: 'skipped_low_confidence' });
  }

  if (!riskManagement.checkAuthority(settings.authority, decision.action)) {
    return logRun({ ...base, action: 'skipped_authority' });
  }

  if (ENTRY_ACTIONS.includes(decision.action)) {
    if (entryBlocked) return logRun({ ...base, action: entryBlocked });

    const cooldownRow = await db.oneOrNone(
      `SELECT id FROM auto_trading_runs
       WHERE user_id = $1 AND symbol = $2 AND action IN ('order_placed', 'position_added')
         AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 minute' * $3
       ORDER BY created_at DESC LIMIT 1`,
      [userId, symbol, settings.cooldown_minutes]
    );
    if (cooldownRow) return logRun({ ...base, action: 'skipped_cooldown' });

    const { count } = await db.one(
      `SELECT COUNT(*) FROM auto_trading_runs
       WHERE user_id = $1 AND action IN ('order_placed', 'position_added') AND created_at >= CURRENT_DATE`,
      [userId]
    );
    if (parseInt(count, 10) >= settings.max_trades_per_day) {
      return logRun({ ...base, action: 'skipped_daily_trade_limit' });
    }

    // The engine never reverses in one step: with any position open,
    // open_long/open_short is a conflict (Claude should 'close' first).
    if ((decision.action === 'open_long' || decision.action === 'open_short') && position) {
      return logRun({ ...base, action: 'skipped_existing_position' });
    }
  } else if (!position) {
    return logRun({ ...base, action: 'error', errorMessage: 'position action without an open position' });
  }

  const result = await executeDecision({
    db, adapter, conn, userId, userEmail, settings, symbol, position, decision, equity,
  });
  return logRun({
    ...base,
    action: result.action,
    orderId: result.orderId,
    errorMessage: result.errorMessage,
    actionDetail: { decision, execution: result.detail || null },
  });
}

// ── Run logging ───────────────────────────────────────────────────────────────

async function logRun({ userId, symbol, timeframe, decision, confidence, action, signalId, orderId, reasoning, errorMessage, actionDetail }) {
  await db.none(
    `INSERT INTO auto_trading_runs
       (user_id, symbol, timeframe, decision, confidence, action, signal_id, order_id, reasoning, error_message, action_detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [userId, symbol, timeframe, decision || null, confidence ?? null, action,
     signalId || null, orderId || null, reasoning || null, errorMessage || null,
     actionDetail ? JSON.stringify(actionDetail) : null]
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
  runForUser, processSymbol, checkCircuitBreaker, CIRCUIT_BREAKER_ERROR_THRESHOLD,
};
