const express = require('express');
const { query, param, validationResult } = require('express-validator');
const { getCurrentPrice, getLiveQuote, getHistoricalData, searchSymbols } = require('../services/marketData');
const { calculateAll } = require('../services/indicators');
const { optionalAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

const VALID_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1mo'];

// GET /api/market/search?q=apple
router.get('/search', optionalAuth, [
  query('q').trim().notEmpty().isLength({ min: 1, max: 50 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const results = await searchSymbols(req.query.q);
  res.json({ results, count: results.length });
}));

// GET /api/market/prices?symbols=AAPL,MSFT — batch price + day-change for a watchlist
router.get('/prices', optionalAuth, [
  query('symbols').trim().notEmpty().isLength({ max: 2000 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const symbols = [...new Set(
    req.query.symbols.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
  )].slice(0, 100);

  const settled = await Promise.allSettled(symbols.map((s) => getCurrentPrice(s)));
  const prices = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) {
      prices.push({ symbol: symbols[i], price: r.value.price, change_percent: Number(r.value.change_percent) });
    }
  });

  res.json({ prices });
}));

// GET /api/market/price/:symbol
router.get('/price/:symbol', optionalAuth, [
  param('symbol').trim().notEmpty().isLength({ max: 20 }).toUpperCase(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const data = await getCurrentPrice(req.params.symbol.toUpperCase());
  res.json({ price: data });
}));

// GET /api/market/quote/:symbol — live bid/ask/last trade (Alpaca, falls back to Yahoo)
router.get('/quote/:symbol', optionalAuth, [
  param('symbol').trim().notEmpty().isLength({ max: 20 }).toUpperCase(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const quote = await getLiveQuote(req.params.symbol.toUpperCase());
  res.json({ quote });
}));

// GET /api/market/history/:symbol?interval=1h&bars=200
router.get('/history/:symbol', optionalAuth, [
  param('symbol').trim().notEmpty().isLength({ max: 20 }),
  query('interval').optional().isIn(VALID_INTERVALS),
  query('bars').optional().isInt({ min: 10, max: 500 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const symbol = req.params.symbol.toUpperCase();
  const interval = req.query.interval || '1h';
  const bars = Math.min(500, parseInt(req.query.bars) || 200);

  const data = await getHistoricalData(symbol, interval, bars);
  res.json({ symbol, interval, bars: data.candles.length, data });
}));

// GET /api/market/indicators/:symbol?interval=1h
router.get('/indicators/:symbol', optionalAuth, [
  param('symbol').trim().notEmpty().isLength({ max: 20 }),
  query('interval').optional().isIn(VALID_INTERVALS),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const symbol = req.params.symbol.toUpperCase();
  const interval = req.query.interval || '1h';

  const data = await getHistoricalData(symbol, interval, 250);
  const indicators = calculateAll(data.candles);

  res.json({
    symbol,
    interval,
    current_price: data.current_price,
    indicators,
    calculated_at: new Date().toISOString(),
  });
}));

// GET /api/market/snapshot/:symbol — price + indicators in one call
router.get('/snapshot/:symbol', optionalAuth, [
  param('symbol').trim().notEmpty().isLength({ max: 20 }),
  query('interval').optional().isIn(VALID_INTERVALS),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const symbol = req.params.symbol.toUpperCase();
  const interval = req.query.interval || '1h';

  const [priceData, histData] = await Promise.all([
    getCurrentPrice(symbol),
    getHistoricalData(symbol, interval, 250),
  ]);

  const indicators = calculateAll(histData.candles);

  res.json({
    symbol,
    interval,
    price: priceData,
    indicators,
    recent_candles: histData.candles.slice(-10),
    calculated_at: new Date().toISOString(),
  });
}));

module.exports = router;
