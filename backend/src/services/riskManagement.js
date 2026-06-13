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

module.exports = {
  calculatePositionSize,
  checkDailyLossLimit,
  DEFAULT_RISK_PER_TRADE_PCT,
  DEFAULT_MAX_DAILY_LOSS_PCT,
};
