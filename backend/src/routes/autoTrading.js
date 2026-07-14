const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { db } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { getAutoTradingSettings, CIRCUIT_BREAKER_ERROR_THRESHOLD } = require('../services/autoTradingEngine');
const { AI_MODE_NAMES } = require('../services/aiModes');

const router = express.Router();

const VALID_TIMEFRAMES = ['15m', '1h', '4h', '1d'];

// ── GET /api/auto-trading/settings ────────────────────────────────────────────

router.get('/settings', authenticate, asyncHandler(async (req, res) => {
  const user = await db.one('SELECT preferences FROM users WHERE id = $1', [req.user.id]);
  res.json({ settings: getAutoTradingSettings(user.preferences) });
}));

// ── PUT /api/auto-trading/settings ────────────────────────────────────────────

router.put('/settings', authenticate, [
  body('enabled').optional().isBoolean(),
  body('broker_connection_id').optional({ nullable: true }).isUUID(),
  body('symbols').optional().isArray(),
  body('symbols.*').optional().trim().toUpperCase().isLength({ min: 1, max: 20 }),
  body('timeframes').optional().isArray(),
  body('timeframes.*').optional().isIn(VALID_TIMEFRAMES),
  body('min_confidence').optional().isInt({ min: 0, max: 100 }),
  body('risk_per_trade_pct').optional().isFloat({ gt: 0, lt: 1 }),
  body('max_daily_loss_pct').optional().isFloat({ gt: 0, lt: 1 }),
  body('cooldown_minutes').optional().isInt({ min: 1, max: 1440 }),
  body('max_trades_per_day').optional().isInt({ min: 1, max: 100 }),
  body('ai_mode').optional().isIn(AI_MODE_NAMES),
  body('authority').optional().isObject(),
  body('authority.close').optional().isBoolean().toBoolean(),
  body('authority.adjust_stop').optional().isBoolean().toBoolean(),
  body('authority.partial_exit').optional().isBoolean().toBoolean(),
  body('authority.add').optional().isBoolean().toBoolean(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  if (req.body.enabled === true) {
    if (!req.body.broker_connection_id) {
      const user = await db.one('SELECT preferences FROM users WHERE id = $1', [req.user.id]);
      if (!getAutoTradingSettings(user.preferences).broker_connection_id) {
        return res.status(400).json({ error: 'broker_connection_id is required to enable auto-trading' });
      }
    }
    if (req.body.symbols !== undefined && req.body.symbols.length === 0) {
      return res.status(400).json({ error: 'At least one symbol is required to enable auto-trading' });
    }
  }

  if (req.body.broker_connection_id) {
    const conn = await db.oneOrNone(
      `SELECT id FROM broker_connections WHERE id = $1 AND user_id = $2`,
      [req.body.broker_connection_id, req.user.id]
    );
    if (!conn) return res.status(404).json({ error: 'Broker connection not found' });
  }

  const user = await db.one('SELECT preferences FROM users WHERE id = $1', [req.user.id]);
  const current = getAutoTradingSettings(user.preferences);
  const merged = {
    ...current,
    ...req.body,
    authority: { ...current.authority, ...(req.body.authority || {}) },
  };

  const updated = await db.one(
    `UPDATE users
     SET preferences = jsonb_set(COALESCE(preferences, '{}'::jsonb), '{auto_trading}', $1::jsonb),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2
     RETURNING preferences`,
    [JSON.stringify(merged), req.user.id]
  );

  res.json({ settings: getAutoTradingSettings(updated.preferences) });
}));

// ── GET /api/auto-trading/activity ────────────────────────────────────────────

router.get('/activity', authenticate, [
  query('limit').optional().isInt({ min: 1, max: 200 }),
  query('offset').optional().isInt({ min: 0 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { limit = 50, offset = 0 } = req.query;

  const runs = await db.manyOrNone(
    `SELECT id, symbol, timeframe, decision, confidence, action, signal_id, order_id, reasoning, error_message, action_detail, created_at
     FROM auto_trading_runs WHERE user_id = $1
     ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [req.user.id, parseInt(limit), parseInt(offset)]
  );
  const { count } = await db.one('SELECT COUNT(*) FROM auto_trading_runs WHERE user_id = $1', [req.user.id]);

  res.json({ runs, total: parseInt(count), limit: parseInt(limit), offset: parseInt(offset) });
}));

// ── GET /api/auto-trading/status ──────────────────────────────────────────────

router.get('/status', authenticate, asyncHandler(async (req, res) => {
  const user = await db.one('SELECT preferences FROM users WHERE id = $1', [req.user.id]);
  const settings = getAutoTradingSettings(user.preferences);

  const lastRun = await db.oneOrNone(
    `SELECT created_at FROM auto_trading_runs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [req.user.id]
  );

  const { count: tradesToday } = await db.one(
    `SELECT COUNT(*) FROM auto_trading_runs
     WHERE user_id = $1 AND action = 'order_placed' AND created_at >= CURRENT_DATE`,
    [req.user.id]
  );

  const { pnl: todaysPnl } = await db.one(
    `SELECT COALESCE(SUM(p.pnl), 0) as pnl
     FROM positions p
     WHERE p.user_id = $1 AND p.opened_at >= CURRENT_DATE
       AND p.symbol IN (
         SELECT DISTINCT symbol FROM auto_trading_runs
         WHERE user_id = $1 AND action = 'order_placed' AND created_at >= CURRENT_DATE
       )`,
    [req.user.id]
  );

  res.json({
    enabled: settings.enabled,
    last_run_at: lastRun?.created_at || null,
    trades_today: parseInt(tradesToday, 10),
    todays_pnl: parseFloat(todaysPnl),
  });
}));

// ── GET /api/auto-trading/benchmark ───────────────────────────────────────────
// Engine equity vs equal-weight buy-and-hold of the watchlist (frozen at
// first snapshot). Rendered as the paper-trial comparison chart.

router.get('/benchmark', authenticate, asyncHandler(async (req, res) => {
  const rows = await db.manyOrNone(
    `SELECT snapshot_date, engine_equity, watchlist_value
     FROM benchmark_snapshots WHERE user_id = $1
     ORDER BY snapshot_date ASC`,
    [req.user.id]
  );
  res.json({
    series: rows.map((r) => ({
      date: r.snapshot_date instanceof Date ? r.snapshot_date.toISOString().slice(0, 10) : String(r.snapshot_date),
      engine_equity: parseFloat(r.engine_equity),
      watchlist_value: parseFloat(r.watchlist_value),
    })),
  });
}));

// ── GET /api/auto-trading/metrics ─────────────────────────────────────────────
// Read-only rollup: health strip + performance KPIs + decision breakdown.

router.get('/metrics', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const ATTRIBUTED = `SELECT DISTINCT symbol FROM auto_trading_runs WHERE user_id = $1 AND action = 'order_placed'`;

  const user = await db.one('SELECT preferences FROM users WHERE id = $1', [userId]);
  const settings = getAutoTradingSettings(user.preferences);

  const lastRun = await db.oneOrNone(
    `SELECT created_at FROM auto_trading_runs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [userId]);
  const errors = await db.one(
    `SELECT COUNT(*) FROM auto_trading_runs WHERE user_id = $1 AND action IN ('error','needs_attention','auto_disabled_errors') AND created_at >= NOW() - INTERVAL '24 hours'`, [userId]);
  const tradesToday = await db.one(
    `SELECT COUNT(*) FROM auto_trading_runs WHERE user_id = $1 AND action = 'order_placed' AND created_at >= CURRENT_DATE`, [userId]);
  const tradesTotal = await db.one(
    `SELECT COUNT(*) FROM auto_trading_runs WHERE user_id = $1 AND action = 'order_placed'`, [userId]);
  const avgConf = await db.one(
    `SELECT AVG(confidence) AS avg FROM auto_trading_runs WHERE user_id = $1 AND confidence IS NOT NULL`, [userId]);
  const breakdown = await db.manyOrNone(
    `SELECT action, COUNT(*)::int AS count FROM auto_trading_runs WHERE user_id = $1 GROUP BY action ORDER BY count DESC`, [userId]);
  const wl = await db.one(
    `SELECT COUNT(*) FILTER (WHERE pnl > 0)::int AS wins, COUNT(*)::int AS total
       FROM positions WHERE user_id = $1 AND status = 'closed' AND symbol IN (${ATTRIBUTED})`, [userId]);
  const snaps = await db.manyOrNone(
    `SELECT engine_equity, watchlist_value FROM benchmark_snapshots WHERE user_id = $1 ORDER BY snapshot_date ASC`, [userId]);

  let returnPct = null;
  let vsBuyHoldPct = null;
  if (snaps.length >= 2) {
    const first = snaps[0];
    const last = snaps[snaps.length - 1];
    const e0 = parseFloat(first.engine_equity);
    const e1 = parseFloat(last.engine_equity);
    const w0 = parseFloat(first.watchlist_value);
    const w1 = parseFloat(last.watchlist_value);
    if (e0 > 0) returnPct = ((e1 - e0) / e0) * 100;
    if (e0 > 0 && w0 > 0) vsBuyHoldPct = returnPct - ((w1 - w0) / w0) * 100;
  }

  res.json({
    health: {
      enabled: settings.enabled,
      last_run_at: lastRun?.created_at || null,
      errors_24h: parseInt(errors.count, 10),
      circuit_breaker_threshold: CIRCUIT_BREAKER_ERROR_THRESHOLD,
      trades_today: parseInt(tradesToday.count, 10),
    },
    performance: {
      return_pct: returnPct,
      vs_buy_hold_pct: vsBuyHoldPct,
      win_rate: parseInt(wl.total, 10) > 0 ? parseInt(wl.wins, 10) / parseInt(wl.total, 10) : null,
      trades: parseInt(tradesTotal.count, 10),
    },
    decision_breakdown: breakdown,
    avg_confidence: avgConf.avg != null ? parseFloat(avgConf.avg) : null,
  });
}));

// ── GET /api/auto-trading/symbol-performance ──────────────────────────────────

router.get('/symbol-performance', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const runRows = await db.manyOrNone(
    `SELECT symbol,
        COUNT(*) FILTER (WHERE action = 'order_placed')::int AS trades,
        AVG(confidence) AS avg_confidence,
        (ARRAY_AGG(action ORDER BY created_at DESC))[1] AS last_action,
        MAX(created_at) AS last_action_at
       FROM auto_trading_runs WHERE user_id = $1 GROUP BY symbol`, [userId]);

  const posRows = await db.manyOrNone(
    `SELECT symbol,
        COALESCE(SUM(pnl) FILTER (WHERE status = 'closed'), 0) AS realized_pnl,
        COALESCE(SUM(pnl) FILTER (WHERE status = 'open'), 0) AS unrealized_pnl,
        COUNT(*) FILTER (WHERE status = 'closed' AND pnl > 0)::int AS wins,
        COUNT(*) FILTER (WHERE status = 'closed')::int AS closed
       FROM positions WHERE user_id = $1 GROUP BY symbol`, [userId]);

  const pnlBySymbol = new Map(posRows.map((r) => [r.symbol, r]));

  const symbols = runRows.map((r) => {
    const p = pnlBySymbol.get(r.symbol);
    const closed = p ? parseInt(p.closed, 10) : 0;
    const wins = p ? parseInt(p.wins, 10) : 0;
    return {
      symbol: r.symbol,
      trades: r.trades,
      win_rate: closed > 0 ? wins / closed : null,
      realized_pnl: p ? parseFloat(p.realized_pnl) : 0,
      unrealized_pnl: p ? parseFloat(p.unrealized_pnl) : 0,
      avg_confidence: r.avg_confidence != null ? parseFloat(r.avg_confidence) : null,
      last_action: r.last_action,
      last_action_at: r.last_action_at,
    };
  }).sort((a, b) => b.trades - a.trades || a.symbol.localeCompare(b.symbol));

  res.json({ symbols });
}));

// ── GET /api/auto-trading/calibration ─────────────────────────────────────────
// Entry confidence = most recent order_placed run for the symbol at/before open.

const CALIBRATION_MIN_REQUIRED = 10;
const CALIBRATION_BUCKETS = [
  { range: '<50', lo: -Infinity, hi: 50 },
  { range: '50-60', lo: 50, hi: 60 },
  { range: '60-70', lo: 60, hi: 70 },
  { range: '70-80', lo: 70, hi: 80 },
  { range: '80-90', lo: 80, hi: 90 },
  { range: '90-100', lo: 90, hi: Infinity },
];

router.get('/calibration', authenticate, asyncHandler(async (req, res) => {
  const rows = await db.manyOrNone(
    `SELECT p.pnl,
        (SELECT r.confidence FROM auto_trading_runs r
           WHERE r.user_id = p.user_id AND r.symbol = p.symbol AND r.action = 'order_placed'
             AND r.confidence IS NOT NULL AND r.created_at <= p.opened_at
           ORDER BY r.created_at DESC LIMIT 1) AS entry_confidence
       FROM positions p WHERE p.user_id = $1 AND p.status = 'closed'`, [req.user.id]);

  const scored = rows.filter((r) => r.entry_confidence != null)
    .map((r) => ({ conf: parseFloat(r.entry_confidence), win: parseFloat(r.pnl) > 0 }));

  const buckets = CALIBRATION_BUCKETS.map((b) => {
    const inBucket = scored.filter((s) => s.conf >= b.lo && s.conf < b.hi);
    return { range: b.range, trades: inBucket.length, win_rate: inBucket.length > 0 ? inBucket.filter((s) => s.win).length / inBucket.length : 0 };
  }).filter((b) => b.trades > 0);

  res.json({
    buckets,
    total_closed: scored.length,
    min_required: CALIBRATION_MIN_REQUIRED,
    sufficient: scored.length >= CALIBRATION_MIN_REQUIRED,
  });
}));

module.exports = router;
