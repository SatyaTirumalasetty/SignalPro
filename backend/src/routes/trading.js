const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../config/database');
const { decryptCredentials } = require('../config/brokerEncryption');
const { getAdapter } = require('../services/brokers/index');
const { getCurrentPrice } = require('../services/marketData');
const riskManagement = require('../services/riskManagement');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../config/logger');

const router = express.Router();

// ── POST /api/trading/orders ──────────────────────────────────────────────────
// Place a new order through a connected broker

router.post('/orders', authenticate, [
  body('broker_connection_id').isUUID().withMessage('broker_connection_id must be a valid UUID'),
  body('symbol').trim().notEmpty().toUpperCase().isLength({ max: 20 }),
  body('side').isIn(['buy', 'sell']),
  body('order_type').optional().isIn(['market', 'limit', 'stop']),
  body('quantity').isFloat({ gt: 0 }).withMessage('quantity must be positive'),
  body('price').optional().isFloat({ gt: 0 }),
  body('stop_loss').optional().isFloat({ gt: 0 }),
  body('take_profit').optional().isFloat({ gt: 0 }),
  body('signal_id').optional().isUUID(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { broker_connection_id, symbol, side, order_type = 'market', quantity, price, stop_loss, take_profit, signal_id } = req.body;

  // Verify connection ownership
  const conn = await db.oneOrNone(
    `SELECT broker_id, credentials_encrypted FROM broker_connections
     WHERE id = $1 AND user_id = $2 AND status = 'connected'`,
    [broker_connection_id, req.user.id]
  );
  if (!conn) return res.status(404).json({ error: 'Active broker connection not found' });

  // Get current market price for order tracking
  let currentPrice = price;
  if (!currentPrice) {
    try {
      const priceData = await getCurrentPrice(symbol);
      currentPrice = priceData.price;
    } catch { /* non-fatal — proceed without price */ }
  }

  // Risk checks: daily loss circuit breaker + stop-loss-based position sizing.
  // Best-effort — only an explicit RISK_LIMIT_EXCEEDED blocks the order.
  let finalQuantity = quantity;
  try {
    const credentials = decryptCredentials(conn.credentials_encrypted);
    const adapter = getAdapter(conn.broker_id, credentials);
    const account = await adapter.getAccountInfo();
    const equity = account?.funds?.equity;

    await riskManagement.checkDailyLossLimit({ db, userId: req.user.id, equity });

    if (stop_loss && currentPrice) {
      const sizedQty = riskManagement.calculatePositionSize({
        equity, entryPrice: currentPrice, stopLoss: stop_loss,
      });
      if (sizedQty > 0 && sizedQty < finalQuantity) {
        logger.warn({ userId: req.user.id, symbol, requested: finalQuantity, capped: sizedQty }, 'Order quantity capped by risk management');
        finalQuantity = sizedQty;
      }
    }
  } catch (err) {
    if (err.code === 'RISK_LIMIT_EXCEEDED') {
      return res.status(403).json({ error: err.message });
    }
    logger.warn({ userId: req.user.id, err: err.message }, 'Risk management check failed — proceeding without sizing');
  }

  // Create order record first (status: pending)
  const orderId = uuidv4();
  await db.none(
    `INSERT INTO orders (id, user_id, broker_connection_id, symbol, order_type, side,
                         quantity, price, stop_loss, take_profit, status, signal_id, created_by_ai, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    [orderId, req.user.id, broker_connection_id, symbol, order_type, side,
     finalQuantity, currentPrice, stop_loss || null, take_profit || null, signal_id || null, !!signal_id]
  );

  // Submit to broker asynchronously
  executeOrderAsync(orderId, req.user.id, conn, symbol, side, order_type, finalQuantity, currentPrice, stop_loss, take_profit);

  res.status(201).json({
    order: { id: orderId, symbol, side, order_type, quantity: finalQuantity, price: currentPrice, stop_loss: stop_loss || null, take_profit: take_profit || null, status: 'pending' },
    message: 'Order submitted',
  });
}));

async function executeOrderAsync(orderId, userId, conn, symbol, side, orderType, quantity, price, stopLoss, takeProfit) {
  try {
    const credentials = decryptCredentials(conn.credentials_encrypted);
    const adapter = getAdapter(conn.broker_id, credentials);

    const result = await adapter.placeOrder?.({
      symbol, side, order_type: orderType, quantity, price, stop_loss: stopLoss, take_profit: takeProfit,
    });

    await db.none(
      `UPDATE orders SET status = 'open', broker_order_id = $1, order_message = $2,
              executed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [result?.order_id || null, result?.message || 'Order submitted to broker', orderId]
    );
  } catch (err) {
    logger.warn({ orderId, err: err.message }, 'Order execution failed');
    await db.none(
      `UPDATE orders SET status = 'rejected', error_message = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [err.message, orderId]
    ).catch(() => {});
  }
}

// ── GET /api/trading/orders ───────────────────────────────────────────────────

router.get('/orders', authenticate, [
  query('symbol').optional().trim().toUpperCase(),
  query('status').optional().isIn(['pending','open','filled','partially_filled','cancelled','rejected']),
  query('side').optional().isIn(['buy','sell']),
  query('limit').optional().isInt({ min: 1, max: 200 }),
  query('offset').optional().isInt({ min: 0 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { symbol, status, side, limit = 50, offset = 0 } = req.query;
  const params = [req.user.id];
  let sql = `SELECT o.*, bc.broker_id, bc.name as broker_name
             FROM orders o
             LEFT JOIN broker_connections bc ON o.broker_connection_id = bc.id
             WHERE o.user_id = $1`;

  if (symbol) { sql += ` AND o.symbol = $${params.length+1}`; params.push(symbol); }
  if (status) { sql += ` AND o.status = $${params.length+1}`; params.push(status); }
  if (side)   { sql += ` AND o.side = $${params.length+1}`; params.push(side); }

  sql += ` ORDER BY o.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
  params.push(parseInt(limit), parseInt(offset));

  const orders = await db.manyOrNone(sql, params);
  const { count } = await db.one('SELECT COUNT(*) FROM orders WHERE user_id = $1', [req.user.id]);

  res.json({ orders, total: parseInt(count), limit: parseInt(limit), offset: parseInt(offset) });
}));

// ── GET /api/trading/orders/:id ───────────────────────────────────────────────

router.get('/orders/:id', authenticate, asyncHandler(async (req, res) => {
  const order = await db.oneOrNone(
    `SELECT o.*, bc.broker_id FROM orders o
     LEFT JOIN broker_connections bc ON o.broker_connection_id = bc.id
     WHERE o.id = $1 AND o.user_id = $2`,
    [req.params.id, req.user.id]
  );
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({ order });
}));

// ── DELETE /api/trading/orders/:id ───────────────────────────────────────────
// Cancel a pending/open order

router.delete('/orders/:id', authenticate, asyncHandler(async (req, res) => {
  const order = await db.oneOrNone(
    `SELECT o.*, bc.credentials_encrypted, bc.broker_id
     FROM orders o
     LEFT JOIN broker_connections bc ON o.broker_connection_id = bc.id
     WHERE o.id = $1 AND o.user_id = $2 AND o.status IN ('pending','open')`,
    [req.params.id, req.user.id]
  );
  if (!order) return res.status(404).json({ error: 'Cancellable order not found' });

  // Try to cancel on broker
  if (order.broker_order_id && order.credentials_encrypted) {
    try {
      const credentials = decryptCredentials(order.credentials_encrypted);
      const adapter = getAdapter(order.broker_id, credentials);
      await adapter.cancelOrder?.(order.broker_order_id);
    } catch (err) {
      logger.warn({ orderId: order.id, err: err.message }, 'Broker cancel failed');
    }
  }

  await db.none(
    `UPDATE orders SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [req.params.id]
  );

  res.json({ message: 'Order cancelled', order_id: req.params.id });
}));

// ── GET /api/trading/positions ────────────────────────────────────────────────

router.get('/positions', authenticate, [
  query('status').optional().isIn(['open', 'closed']),
  query('symbol').optional().trim().toUpperCase(),
  query('limit').optional().isInt({ min: 1, max: 200 }),
  query('offset').optional().isInt({ min: 0 }),
], asyncHandler(async (req, res) => {
  const { status = 'open', symbol, limit = 50, offset = 0 } = req.query;
  const params = [req.user.id, status];
  let sql = `SELECT p.*, bc.broker_id, bc.name as broker_name
             FROM positions p
             LEFT JOIN broker_connections bc ON p.broker_connection_id = bc.id
             WHERE p.user_id = $1 AND p.status = $2`;

  if (symbol) { sql += ` AND p.symbol = $${params.length+1}`; params.push(symbol.toUpperCase()); }
  sql += ` ORDER BY p.opened_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
  params.push(parseInt(limit), parseInt(offset));

  const positions = await db.manyOrNone(sql, params);
  const { count } = await db.one(
    'SELECT COUNT(*) FROM positions WHERE user_id = $1 AND status = $2', [req.user.id, status]
  );

  res.json({ positions, total: parseInt(count), status });
}));

// ── GET /api/trading/positions/:id ───────────────────────────────────────────

router.get('/positions/:id', authenticate, asyncHandler(async (req, res) => {
  const position = await db.oneOrNone(
    `SELECT p.*, bc.broker_id FROM positions p
     LEFT JOIN broker_connections bc ON p.broker_connection_id = bc.id
     WHERE p.id = $1 AND p.user_id = $2`,
    [req.params.id, req.user.id]
  );
  if (!position) return res.status(404).json({ error: 'Position not found' });
  res.json({ position });
}));

// ── POST /api/trading/positions/:id/close ────────────────────────────────────

router.post('/positions/:id/close', authenticate, [
  body('quantity').optional().isFloat({ gt: 0 }),
], asyncHandler(async (req, res) => {
  const position = await db.oneOrNone(
    `SELECT p.*, bc.credentials_encrypted, bc.broker_id
     FROM positions p
     LEFT JOIN broker_connections bc ON p.broker_connection_id = bc.id
     WHERE p.id = $1 AND p.user_id = $2 AND p.status = 'open'`,
    [req.params.id, req.user.id]
  );
  if (!position) return res.status(404).json({ error: 'Open position not found' });

  const closeQty = req.body.quantity || position.quantity;
  const closeSide = position.position_type === 'long' ? 'sell' : 'buy';

  // Get current price for P&L calculation
  let closePrice = position.current_price;
  try {
    const priceData = await getCurrentPrice(position.symbol);
    closePrice = priceData.price;
  } catch { /* use last known price */ }

  const pnl = (closePrice - position.entry_price) * closeQty * (position.position_type === 'long' ? 1 : -1);
  const pnlPercent = (pnl / (position.entry_price * closeQty)) * 100;

  await db.none(
    `UPDATE positions SET status = 'closed', current_price = $1, pnl = $2, pnl_percent = $3,
            closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = $4`,
    [closePrice, pnl.toFixed(2), pnlPercent.toFixed(2), req.params.id]
  );

  // Create closing order
  const closeOrderId = uuidv4();
  await db.none(
    `INSERT INTO orders (id, user_id, broker_connection_id, symbol, order_type, side, quantity,
                         price, status, executed_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,'market',$5,$6,$7,'filled',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    [closeOrderId, req.user.id, position.broker_connection_id, position.symbol, closeSide, closeQty, closePrice]
  );

  res.json({
    message: 'Position closed',
    pnl: parseFloat(pnl.toFixed(2)),
    pnl_percent: parseFloat(pnlPercent.toFixed(2)),
    close_price: closePrice,
    order_id: closeOrderId,
  });
}));

// ── GET /api/trading/portfolio ────────────────────────────────────────────────
// Portfolio summary: open positions with live prices

router.get('/portfolio', authenticate, asyncHandler(async (req, res) => {
  const positions = await db.manyOrNone(
    `SELECT symbol, position_type, SUM(quantity) as total_quantity,
            AVG(entry_price) as avg_entry, SUM(pnl) as total_pnl,
            COUNT(*) as position_count
     FROM positions WHERE user_id = $1 AND status = 'open'
     GROUP BY symbol, position_type
     ORDER BY total_pnl DESC NULLS LAST`,
    [req.user.id]
  );

  const summary = await db.one(
    `SELECT COUNT(*) FILTER (WHERE status = 'open') as open_positions,
            COUNT(*) FILTER (WHERE status = 'closed') as closed_positions,
            COALESCE(SUM(pnl) FILTER (WHERE status = 'closed'), 0) as realized_pnl,
            COALESCE(SUM(pnl) FILTER (WHERE status = 'open'), 0) as unrealized_pnl
     FROM positions WHERE user_id = $1`,
    [req.user.id]
  );

  res.json({ positions, summary });
}));

module.exports = router;
