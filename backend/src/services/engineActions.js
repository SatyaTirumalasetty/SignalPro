// Executes a validated, authority-approved decision against the broker.
// Every path returns an action string for the run log — never a silent no-op.

const riskManagement = require('./riskManagement');
const { placeOrder } = require('./orderExecution');
const {
  sendAutoTradingActionEmail,
  sendAutoTradingNeedsAttentionEmail,
} = require('./emailService');
const logger = require('../config/logger');

const CAPABILITY_REQUIREMENTS = {
  open_long: ['place_order'],
  open_short: ['place_order'],
  add: ['place_order'],
  close: ['open_orders', 'cancel_order', 'close_position'],
  partial_exit: ['open_orders', 'cancel_order', 'close_position'],
  adjust_stop: ['open_orders', 'replace_order'],
};

function hasCapabilities(adapter, action) {
  const caps = typeof adapter.capabilities === 'function' ? adapter.capabilities() : [];
  return (CAPABILITY_REQUIREMENTS[action] || []).every((c) => caps.includes(c));
}

function notify(userEmail, symbol, action, detail) {
  if (!userEmail) return;
  sendAutoTradingActionEmail(userEmail, { symbol, action, detail }).catch((err) =>
    logger.error({ symbol, err: err.message }, 'Failed to send auto-trading action email')
  );
}

async function attention(userEmail, symbol, message) {
  if (!userEmail) return;
  await sendAutoTradingNeedsAttentionEmail(userEmail, { symbol, message }).catch((err) =>
    logger.error({ symbol, err: err.message }, 'Failed to send needs-attention email')
  );
}

async function openOrAdd({ conn, userId, userEmail, settings, symbol, position, decision, equity }) {
  const quantity = riskManagement.calculatePositionSize({
    equity,
    riskPerTradePct: settings.risk_per_trade_pct,
    entryPrice: decision.entry_price,
    stopLoss: decision.stop_loss,
  });
  if (quantity <= 0) return { action: 'skipped_risk_sizing' };

  let side;
  if (decision.action === 'add') side = position.position_type === 'long' ? 'buy' : 'sell';
  else side = decision.action === 'open_long' ? 'buy' : 'sell';

  const order = await placeOrder({
    userId, brokerConnectionId: conn.id, conn, symbol, side, orderType: 'market',
    quantity, price: decision.entry_price, stopLoss: decision.stop_loss,
    takeProfit: decision.take_profit, signalId: decision.id, source: 'auto_engine',
  });
  notify(userEmail, symbol, decision.action, `${side} ${quantity} @ ~${decision.entry_price}`);
  return {
    action: decision.action === 'add' ? 'position_added' : 'order_placed',
    orderId: order.id,
    detail: { side, quantity },
  };
}

// Cancels the symbol's open (protective) orders. Throwing here is safe:
// nothing has been cancelled or closed yet.
async function cancelOpenOrders(adapter, symbol) {
  const orders = await adapter.getOpenOrders(symbol);
  for (const o of orders) await adapter.cancelOrder(o.broker_order_id);
  return orders;
}

async function closeFully({ adapter, userEmail, symbol }) {
  let cancelled;
  try {
    cancelled = await cancelOpenOrders(adapter, symbol);
  } catch (err) {
    return { action: 'error', errorMessage: `failed to cancel open orders before close: ${err.message}` };
  }
  try {
    const result = await adapter.closePosition(symbol);
    notify(userEmail, symbol, 'position_closed', result.message);
    return { action: 'position_closed', detail: { broker_order_id: result.order_id, cancelled_orders: cancelled.length } };
  } catch (err) {
    // Protective orders are gone but the position is still open — unprotected.
    await attention(userEmail, symbol, `Close failed after protective orders were cancelled: ${err.message}`);
    return { action: 'needs_attention', errorMessage: err.message, detail: { cancelled_orders: cancelled.length } };
  }
}

async function partialExit({ adapter, userEmail, symbol, position, decision }) {
  const quantity = riskManagement.partialExitQuantity({
    positionQty: position.quantity,
    exitFraction: decision.exit_fraction,
  });
  if (quantity <= 0) return { action: 'skipped_risk_sizing' };
  if (quantity >= position.quantity) return closeFully({ adapter, userEmail, symbol });

  let cancelled;
  try {
    cancelled = await cancelOpenOrders(adapter, symbol);
  } catch (err) {
    return { action: 'error', errorMessage: `failed to cancel open orders before partial exit: ${err.message}` };
  }
  try {
    const result = await adapter.closePosition(symbol, quantity);
    const remaining = position.quantity - quantity;
    notify(userEmail, symbol, 'partial_exit', `sold ${quantity}, ${remaining} remaining (unprotected until next cycle)`);
    return {
      action: 'partial_exit',
      detail: {
        broker_order_id: result.order_id, quantity, remaining,
        cancelled_orders: cancelled.length,
        // The remainder has no bracket until the next cycle adjusts/closes.
        unprotected_remainder: true,
      },
    };
  } catch (err) {
    await attention(userEmail, symbol, `Partial exit failed after protective orders were cancelled: ${err.message}`);
    return { action: 'needs_attention', errorMessage: err.message, detail: { cancelled_orders: cancelled.length } };
  }
}

async function adjustStop({ adapter, userEmail, symbol, position, decision }) {
  const orders = await adapter.getOpenOrders(symbol);
  const stopOrder = orders.find((o) => String(o.order_type || '').includes('stop'));
  if (!stopOrder) {
    return { action: 'error', errorMessage: 'no open stop order to adjust' };
  }
  const ok = riskManagement.validateStopAdjustment({
    positionType: position.position_type,
    currentStop: stopOrder.stop_price,
    newStop: decision.stop_loss,
  });
  if (!ok) return { action: 'skipped_stop_widening', detail: { current_stop: stopOrder.stop_price, proposed: decision.stop_loss } };

  const result = await adapter.replaceOrder(stopOrder.broker_order_id, { stop_price: decision.stop_loss });
  notify(userEmail, symbol, 'stop_adjusted', `stop moved ${stopOrder.stop_price} → ${decision.stop_loss}`);
  return { action: 'stop_adjusted', detail: { from: stopOrder.stop_price, to: decision.stop_loss, broker_order_id: result.order_id } };
}

async function executeDecision(params) {
  const { adapter, decision } = params;
  if (!hasCapabilities(adapter, decision.action)) {
    return { action: 'skipped_unsupported_broker' };
  }
  try {
    switch (decision.action) {
      case 'open_long':
      case 'open_short':
      case 'add':
        return await openOrAdd(params);
      case 'close':
        return await closeFully(params);
      case 'partial_exit':
        return await partialExit(params);
      case 'adjust_stop':
        return await adjustStop(params);
      default:
        return { action: 'error', errorMessage: `unknown action ${decision.action}` };
    }
  } catch (err) {
    return { action: 'error', errorMessage: err.message };
  }
}

module.exports = { executeDecision, hasCapabilities, CAPABILITY_REQUIREMENTS };
