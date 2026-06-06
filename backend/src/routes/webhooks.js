const express = require('express');
const crypto = require('crypto');
const { db } = require('../config/database');
const { decryptCredentials } = require('../config/brokerEncryption');
const logger = require('../config/logger');

const router = express.Router();

// Use raw body for signature verification — must be applied before express.json()
// Mount this router BEFORE body-parser middleware in server.js (or use rawBody below)
router.use(express.raw({ type: 'application/json' }));

// ── Helpers ───────────────────────────────────────────────────────────────────

function verifyHmac(body, secret, signature, algo = 'sha256') {
  const expected = crypto.createHmac(algo, secret).update(body).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

async function getConnectionByBrokerUserId(brokerId, brokerUserId) {
  return db.oneOrNone(
    `SELECT id, user_id, credentials_encrypted
     FROM broker_connections
     WHERE broker_id = $1 AND account_info->>'broker_user_id' = $2 AND status = 'connected'`,
    [brokerId, String(brokerUserId)]
  );
}

async function saveOrderUpdate(userId, connectionId, orderData) {
  await db.none(
    `INSERT INTO orders
       (id, user_id, broker_connection_id, broker_order_id, symbol, order_type, side,
        quantity, price, status, filled_quantity, average_price, executed_at, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (broker_order_id) DO UPDATE
       SET status = EXCLUDED.status, filled_quantity = EXCLUDED.filled_quantity,
           average_price = EXCLUDED.average_price, executed_at = EXCLUDED.executed_at,
           updated_at = CURRENT_TIMESTAMP`,
    [
      userId, connectionId,
      orderData.broker_order_id, orderData.symbol, orderData.order_type, orderData.side,
      orderData.quantity, orderData.price, orderData.status,
      orderData.filled_quantity || 0, orderData.average_price,
      orderData.status === 'filled' ? new Date() : null,
    ]
  ).catch(err => logger.warn({ err: err.message }, 'Failed to save order update'));
}

// ── POST /api/webhooks/zerodha ────────────────────────────────────────────────
// Zerodha sends order postback to this endpoint.
// Signature: SHA-256(order_id + user_id + checksum_secret) from Kite Connect

router.post('/zerodha', async (req, res) => {
  res.sendStatus(200); // always ack immediately
  const raw = req.body;
  let payload;
  try { payload = JSON.parse(raw); } catch { return; }

  const { order_id, user_id: brokerUserId, status, tradingsymbol, transaction_type,
          quantity, price, average_price, filled_quantity } = payload;

  const connection = await getConnectionByBrokerUserId('zerodha', brokerUserId).catch(() => null);
  if (!connection) return;

  const creds = decryptCredentials(connection.credentials_encrypted);
  const expectedSig = crypto.createHash('sha256')
    .update(`${order_id}${brokerUserId}${creds.api_secret}`)
    .digest('hex');

  if (payload.checksum !== expectedSig) {
    logger.warn({ order_id }, 'Zerodha webhook signature mismatch');
    return;
  }

  await saveOrderUpdate(connection.user_id, connection.id, {
    broker_order_id: order_id,
    symbol: tradingsymbol,
    order_type: 'market',
    side: transaction_type?.toLowerCase(),
    quantity, price, status: mapZerodhaStatus(status),
    filled_quantity, average_price,
  });

  logger.info({ order_id, status }, 'Zerodha order update processed');
});

// ── POST /api/webhooks/alpaca ─────────────────────────────────────────────────
// Alpaca sends trade updates signed with HMAC-SHA256

router.post('/alpaca', async (req, res) => {
  res.sendStatus(200);
  const raw = req.body;
  const signature = req.headers['apca-signature'];
  const secret = process.env.ALPACA_WEBHOOK_SECRET;

  if (secret && signature && !verifyHmac(raw, secret, signature)) {
    logger.warn('Alpaca webhook signature mismatch');
    return;
  }

  let payload;
  try { payload = JSON.parse(raw); } catch { return; }

  const { event, order } = payload;
  if (!order) return;

  const connection = await getConnectionByBrokerUserId('alpaca', order.id).catch(() => null);
  if (!connection) return;

  await saveOrderUpdate(connection.user_id, connection.id, {
    broker_order_id: order.id,
    symbol: order.symbol,
    order_type: order.type,
    side: order.side,
    quantity: +order.qty,
    price: order.limit_price ? +order.limit_price : null,
    status: mapAlpacaStatus(order.status),
    filled_quantity: +(order.filled_qty || 0),
    average_price: order.filled_avg_price ? +order.filled_avg_price : null,
  });

  logger.info({ event, orderId: order.id }, 'Alpaca order update processed');
});

// ── POST /api/webhooks/coinbase ───────────────────────────────────────────────

router.post('/coinbase', async (req, res) => {
  res.sendStatus(200);
  const raw = req.body;
  const signature  = req.headers['cb-signature'];
  const timestamp  = req.headers['cb-timestamp'];
  const secret = process.env.COINBASE_WEBHOOK_SECRET;

  if (secret && signature) {
    const msg = timestamp + raw.toString();
    const valid = verifyHmac(Buffer.from(msg), secret, signature);
    if (!valid) { logger.warn('Coinbase webhook signature mismatch'); return; }
  }

  let payload;
  try { payload = JSON.parse(raw); } catch { return; }

  logger.info({ type: payload.type }, 'Coinbase webhook received');
  // TODO: handle specific Coinbase event types (order filled, etc.)
});

// ── Status maps ───────────────────────────────────────────────────────────────

function mapZerodhaStatus(s) {
  const m = { COMPLETE: 'filled', OPEN: 'open', CANCELLED: 'cancelled', REJECTED: 'rejected', 'TRIGGER PENDING': 'pending' };
  return m[s] || s?.toLowerCase() || 'unknown';
}

function mapAlpacaStatus(s) {
  const m = { new: 'pending', accepted: 'pending', partially_filled: 'partially_filled',
    filled: 'filled', done_for_day: 'filled', canceled: 'cancelled', expired: 'cancelled',
    replaced: 'cancelled', rejected: 'rejected' };
  return m[s] || s;
}

module.exports = router;
