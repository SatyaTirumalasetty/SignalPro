const express = require('express');
const { body, validationResult } = require('express-validator');
const { runBacktest } = require('../services/backtest');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// ── POST /api/backtest/run ────────────────────────────────────────────────
// Runs the baseline strategy over historical candles and returns
// trade-by-trade and summary performance stats. No DB writes.

router.post('/run', authenticate, [
  body('symbol').trim().notEmpty().toUpperCase().isLength({ max: 20 }),
  body('timeframe').optional().isIn(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1mo']),
  body('bars').optional().isInt({ min: 50, max: 1000 }),
  body('initial_equity').optional().isFloat({ gt: 0 }),
  body('risk_per_trade_pct').optional().isFloat({ gt: 0, lt: 1 }),
  body('atr_stop_multiple').optional().isFloat({ gt: 0 }),
  body('atr_target_multiple').optional().isFloat({ gt: 0 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const {
    symbol, timeframe, bars,
    initial_equity, risk_per_trade_pct, atr_stop_multiple, atr_target_multiple,
  } = req.body;

  const result = await runBacktest({
    symbol,
    timeframe,
    bars,
    initialEquity: initial_equity,
    riskPerTradePct: risk_per_trade_pct,
    atrStopMultiple: atr_stop_multiple,
    atrTargetMultiple: atr_target_multiple,
  });

  res.json(result);
}));

module.exports = router;
