// Deterministic, explainable trend-following baseline strategy used for
// backtesting. Operates on the output of indicators.calculateAll().
// Not used for live AI signal generation (see services/aiAnalysis.js).

function generateSignal(indicators) {
  const { ema_12, ema_26, rsi_14, sma_50, current_price } = indicators;

  if (ema_12 == null || ema_26 == null || rsi_14 == null || sma_50 == null || current_price == null) {
    return 'hold';
  }

  if (ema_12 > ema_26 && rsi_14 < 70 && current_price > sma_50) {
    return 'buy';
  }

  if (ema_12 < ema_26 || rsi_14 > 80) {
    return 'sell';
  }

  return 'hold';
}

module.exports = { generateSignal };
