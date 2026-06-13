const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { getHistoricalData } = require('../services/marketData');
const { calculateAll } = require('../services/indicators');
const { generateSignal } = require('../services/aiAnalysis');
const { getNews } = require('../services/alpacaMarketData');
const { db } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

const VALID_TIMEFRAMES = ['15m', '1h', '4h', '1d'];

// ── POST /api/analysis/generate ───────────────────────────────────────────────
// Generate a Claude AI trading signal for a symbol

router.post('/generate', authenticate, [
  body('symbol').trim().notEmpty().toUpperCase().isLength({ max: 20 }),
  body('timeframe').optional().isIn(VALID_TIMEFRAMES),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { symbol, timeframe = '1h' } = req.body;

  const histData = await getHistoricalData(symbol, timeframe, 250);

  if (!histData.candles.length) {
    return res.status(404).json({ error: `No market data available for ${symbol}` });
  }

  const indicators = calculateAll(histData.candles);
  const news = await getNews([symbol], 5);
  const signal = await generateSignal(req.user.id, symbol, timeframe, histData, indicators, news);

  res.json({ signal });
}));

// ── GET /api/analysis/signals ─────────────────────────────────────────────────
// List user's historical signals

router.get('/signals', authenticate, [
  query('symbol').optional().trim().toUpperCase(),
  query('timeframe').optional().isIn(VALID_TIMEFRAMES),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { symbol, timeframe, limit = 20, offset = 0 } = req.query;

  let sql = `SELECT id, symbol, market, signal_type, confidence, timeframe, analysis_text,
                    ai_model, ai_tokens_used, entry_price, stop_loss, take_profit,
                    predicted_price_high, predicted_price_low, indicators, status,
                    actual_result, executed_at, expires_at, created_at
             FROM historical_signals
             WHERE user_id = $1`;
  const params = [req.user.id];

  if (symbol) { sql += ` AND symbol = $${params.length + 1}`; params.push(symbol); }
  if (timeframe) { sql += ` AND timeframe = $${params.length + 1}`; params.push(timeframe); }
  sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(parseInt(limit), parseInt(offset));

  const signals = await db.manyOrNone(sql, params);
  const total = await db.one('SELECT COUNT(*) FROM historical_signals WHERE user_id = $1', [req.user.id]);

  res.json({ signals, total: parseInt(total.count), limit: parseInt(limit), offset: parseInt(offset) });
}));

// ── GET /api/analysis/signals/:id ─────────────────────────────────────────────

router.get('/signals/:id', authenticate, asyncHandler(async (req, res) => {
  const signal = await db.oneOrNone(
    `SELECT * FROM historical_signals WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user.id]
  );
  if (!signal) return res.status(404).json({ error: 'Signal not found' });
  res.json({ signal });
}));

// ── GET /api/analysis/performance ─────────────────────────────────────────────
// Signal accuracy stats for the authenticated user

router.get('/performance', authenticate, asyncHandler(async (req, res) => {
  const stats = await db.manyOrNone(
    `SELECT signal_type, COUNT(*) as total,
            SUM(CASE WHEN status = 'executed' THEN 1 ELSE 0 END) as executed,
            AVG(confidence) as avg_confidence,
            AVG((actual_result->>'pnl_percent')::DECIMAL) as avg_pnl_percent
     FROM historical_signals
     WHERE user_id = $1
     GROUP BY signal_type`,
    [req.user.id]
  );

  const overall = await db.one(
    `SELECT COUNT(*) as total_signals,
            SUM(CASE WHEN status = 'executed' THEN 1 ELSE 0 END) as executed,
            AVG(confidence) as avg_confidence,
            SUM(ai_tokens_used) as total_tokens_used
     FROM historical_signals WHERE user_id = $1`,
    [req.user.id]
  );

  res.json({ by_type: stats, overall });
}));

// ── GET /api/analysis/latest/:symbol ─────────────────────────────────────────
// Latest cached signal for a symbol

router.get('/latest/:symbol', authenticate, [
  param('symbol').trim().notEmpty().toUpperCase().isLength({ max: 20 }),
], asyncHandler(async (req, res) => {
  const cached = await db.oneOrNone(
    'SELECT * FROM signal_cache WHERE symbol = $1',
    [req.params.symbol.toUpperCase()]
  );

  if (!cached) return res.status(404).json({ error: 'No cached signal for this symbol' });

  res.json({ symbol: cached.symbol, signal: cached.signal_data, updated_at: cached.updated_at });
}));

module.exports = router;
