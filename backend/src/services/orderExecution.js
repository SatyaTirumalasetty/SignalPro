// Shared order-placement logic used by both the manual order route
// (POST /api/trading/orders) and the autonomous trading engine.

const { v4: uuidv4 } = require('uuid');
const { db } = require('../config/database');
const { decryptCredentials } = require('../config/brokerEncryption');
const { getAdapter } = require('./brokers/index');
const logger = require('../config/logger');

// Inserts the order row (status: pending) and submits it to the broker
// asynchronously. Returns the order summary immediately, mirroring the
// previous behaviour of POST /api/trading/orders.
async function placeOrder({
  userId, brokerConnectionId, conn, symbol, side, orderType = 'market',
  quantity, price, stopLoss, takeProfit, signalId, source = 'manual',
}) {
  const orderId = uuidv4();
  await db.none(
    `INSERT INTO orders (id, user_id, broker_connection_id, symbol, order_type, side,
                         quantity, price, stop_loss, take_profit, status, signal_id, created_by_ai, source, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12,$13,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    [orderId, userId, brokerConnectionId, symbol, orderType, side,
     quantity, price || null, stopLoss || null, takeProfit || null, signalId || null, !!signalId, source]
  );

  executeOrderAsync(orderId, conn, symbol, side, orderType, quantity, price, stopLoss, takeProfit);

  return {
    id: orderId, symbol, side, order_type: orderType, quantity, price: price || null,
    stop_loss: stopLoss || null, take_profit: takeProfit || null, status: 'pending',
  };
}

async function executeOrderAsync(orderId, conn, symbol, side, orderType, quantity, price, stopLoss, takeProfit) {
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

module.exports = { placeOrder, executeOrderAsync };
