const express = require('express');
const { body, validationResult } = require('express-validator');
const { db } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// Curated top-20 large-caps. Seeded once on a user's first visit; membership
// source of truth for the frontend (which keeps its own display-name map).
const WATCHLIST_SEED = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'BRK.B', 'JPM', 'V',
  'UNH', 'XOM', 'JNJ', 'WMT', 'MA', 'PG', 'HD', 'COST', 'ORCL', 'NFLX',
];

const TICKER_RE = /^[A-Z0-9.\-]+$/;

// ── GET /api/watchlist ────────────────────────────────────────────────────────
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const user = await db.one('SELECT preferences FROM users WHERE id = $1', [req.user.id]);
  const wl = user.preferences?.watchlist;
  res.json({ symbols: Array.isArray(wl) ? wl : WATCHLIST_SEED });
}));

// ── PUT /api/watchlist ────────────────────────────────────────────────────────
// Replace the whole list. The client always sends the new full list.
router.put('/', authenticate, [
  body('symbols').isArray({ max: 100 }),
  body('symbols.*').isString().trim().toUpperCase().isLength({ min: 1, max: 20 }).matches(TICKER_RE),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  // De-duplicate preserving order (values already trimmed/upper-cased by the sanitizer).
  const seen = new Set();
  const symbols = [];
  for (const s of req.body.symbols) {
    if (!seen.has(s)) { seen.add(s); symbols.push(s); }
  }

  const updated = await db.one(
    `UPDATE users
       SET preferences = jsonb_set(COALESCE(preferences, '{}'::jsonb), '{watchlist}', $1::jsonb),
           updated_at = CURRENT_TIMESTAMP
     WHERE id = $2
     RETURNING preferences`,
    [JSON.stringify(symbols), req.user.id]
  );

  res.json({ symbols: updated.preferences.watchlist });
}));

module.exports = router;
module.exports.WATCHLIST_SEED = WATCHLIST_SEED;
