const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { db } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { getAutoTradingSettings } = require('../services/autoTradingEngine');
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

module.exports = router;
