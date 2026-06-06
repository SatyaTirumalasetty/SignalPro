const express = require('express');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

// TODO: Implement trading functionality
// - Place orders (buy/sell)
// - Get positions
// - Get orders
// - Close positions
// - Track P&L

router.get('/positions', authenticate, async (req, res) => {
  res.json({ positions: [] });
});

module.exports = router;
