// Risk management helpers for order placement and backtesting.
// Keeps position sizing and loss-limit logic in one place so live trading
// and the backtest engine apply the same rules.

const DEFAULT_RISK_PER_TRADE_PCT = 0.01; // risk 1% of equity per trade
const DEFAULT_MAX_DAILY_LOSS_PCT = 0.03; // stop new trades after losing 3% of equity in a day

// Computes the maximum position size such that a stop-loss hit loses no
// more than `riskPerTradePct` of `equity`, capped by what `equity` can buy
// outright (no leverage assumed). Returns 0 if inputs don't allow a safe size.
function calculatePositionSize({ equity, riskPerTradePct = DEFAULT_RISK_PER_TRADE_PCT, entryPrice, stopLoss }) {
  if (!equity || !entryPrice || !stopLoss) return 0;

  const perUnitRisk = Math.abs(entryPrice - stopLoss);
  if (perUnitRisk <= 0) return 0;

  const riskAmount = equity * riskPerTradePct;
  const riskBasedQty = Math.floor(riskAmount / perUnitRisk);
  const affordableQty = Math.floor(equity / entryPrice);

  return Math.max(0, Math.min(riskBasedQty, affordableQty));
}

// Throws a 403 RISK_LIMIT_EXCEEDED error if the user's realized losses for
// today already meet/exceed `maxDailyLossPct` of `equity`.
async function checkDailyLossLimit({ db, userId, equity, maxDailyLossPct = DEFAULT_MAX_DAILY_LOSS_PCT }) {
  if (!equity) return;

  const { realized_pnl } = await db.one(
    `SELECT COALESCE(SUM(pnl), 0) as realized_pnl FROM positions
     WHERE user_id = $1 AND status = 'closed' AND closed_at >= CURRENT_DATE`,
    [userId]
  );

  const lossLimit = equity * maxDailyLossPct;
  if (-parseFloat(realized_pnl) >= lossLimit) {
    const err = new Error('Daily loss limit reached — new orders are blocked until tomorrow');
    err.code = 'RISK_LIMIT_EXCEEDED';
    err.status = 403;
    throw err;
  }
}

// ── Engine v2: authority + position-management guardrails ────────────────────

// Which position-management actions the engine may take autonomously.
// Entries and hold are governed by the master `enabled` flag, not by these.
const DEFAULT_AUTHORITY = { close: true, adjust_stop: false, partial_exit: false, add: false };

function checkAuthority(authority, action) {
  const effective = authority ?? DEFAULT_AUTHORITY;
  if (action in DEFAULT_AUTHORITY) return effective[action] === true;
  return true;
}

// Stops may only tighten: higher for longs, lower for shorts. No current
// stop means setting one is always the safer direction.
function validateStopAdjustment({ positionType, currentStop, newStop }) {
  if (!newStop || newStop <= 0) return false;
  if (currentStop == null) return true;
  return positionType === 'long' ? newStop > currentStop : newStop < currentStop;
}

// Whole-share partial exit; 0 means "can't size safely, skip".
function partialExitQuantity({ positionQty, exitFraction }) {
  if (!positionQty || !exitFraction || exitFraction <= 0 || exitFraction >= 1) return 0;
  return Math.floor(positionQty * exitFraction);
}

module.exports = {
  calculatePositionSize,
  checkDailyLossLimit,
  DEFAULT_RISK_PER_TRADE_PCT,
  DEFAULT_MAX_DAILY_LOSS_PCT,
  DEFAULT_AUTHORITY,
  checkAuthority,
  validateStopAdjustment,
  partialExitQuantity,
};
