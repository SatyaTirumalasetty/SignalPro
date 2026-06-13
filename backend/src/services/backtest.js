// Backtesting engine: simulates the baseline smaRsiStrategy over historical
// candles, applying the same risk-management rules (position sizing,
// ATR-based stop-loss/take-profit) used for live order placement.

const { getHistoricalData } = require('./marketData');
const { calculateAll } = require('./indicators');
const strategy = require('./strategies/smaRsiStrategy');
const riskManagement = require('./riskManagement');

const DEFAULT_INITIAL_EQUITY = 100000;
const DEFAULT_ATR_STOP_MULTIPLE = 2;
const DEFAULT_ATR_TARGET_MULTIPLE = 3;

async function runBacktest({
  symbol,
  timeframe = '1d',
  bars = 300,
  initialEquity = DEFAULT_INITIAL_EQUITY,
  riskPerTradePct = riskManagement.DEFAULT_RISK_PER_TRADE_PCT,
  atrStopMultiple = DEFAULT_ATR_STOP_MULTIPLE,
  atrTargetMultiple = DEFAULT_ATR_TARGET_MULTIPLE,
}) {
  const { candles } = await getHistoricalData(symbol, timeframe, bars);

  let equity = initialEquity;
  let position = null;
  const trades = [];
  const equityCurve = [];

  for (let i = 1; i < candles.length; i++) {
    const candle = candles[i];
    const indicators = calculateAll(candles.slice(0, i + 1));

    if (position) {
      const exit = checkExit(position, candle, indicators);
      if (exit) {
        const pnl = (exit.price - position.entryPrice) * position.quantity;
        equity += pnl;
        trades.push(buildTrade(symbol, position, exit, pnl));
        position = null;
      }
    }

    if (!position) {
      position = tryEnter(indicators, candle, equity, riskPerTradePct, atrStopMultiple, atrTargetMultiple);
    }

    const unrealized = position ? (candle.close - position.entryPrice) * position.quantity : 0;
    equityCurve.push({ time: candle.time, equity: round2(equity + unrealized) });
  }

  if (position) {
    const last = candles[candles.length - 1];
    const pnl = (last.close - position.entryPrice) * position.quantity;
    equity += pnl;
    trades.push(buildTrade(symbol, position, { price: last.close, time: last.time, reason: 'end_of_data' }, pnl));
    if (equityCurve.length) equityCurve[equityCurve.length - 1].equity = round2(equity);
  }

  return {
    summary: buildSummary({ trades, equityCurve, initialEquity, finalEquity: equity }),
    trades,
    equity_curve: equityCurve,
  };
}

function checkExit(position, candle, indicators) {
  if (candle.low <= position.stopLoss) {
    return { price: position.stopLoss, time: candle.time, reason: 'stop_loss' };
  }
  if (candle.high >= position.takeProfit) {
    return { price: position.takeProfit, time: candle.time, reason: 'take_profit' };
  }
  if (strategy.generateSignal(indicators) === 'sell') {
    return { price: candle.close, time: candle.time, reason: 'signal' };
  }
  return null;
}

function tryEnter(indicators, candle, equity, riskPerTradePct, atrStopMultiple, atrTargetMultiple) {
  if (strategy.generateSignal(indicators) !== 'buy' || !indicators.atr_14) return null;

  const entryPrice = candle.close;
  const stopLoss = entryPrice - indicators.atr_14 * atrStopMultiple;
  const takeProfit = entryPrice + indicators.atr_14 * atrTargetMultiple;
  const quantity = riskManagement.calculatePositionSize({ equity, riskPerTradePct, entryPrice, stopLoss });

  if (quantity <= 0) return null;
  return { quantity, entryPrice, stopLoss, takeProfit, entryTime: candle.time };
}

function buildTrade(symbol, position, exit, pnl) {
  return {
    symbol,
    side: 'long',
    quantity: position.quantity,
    entry_price: position.entryPrice,
    exit_price: exit.price,
    entry_time: position.entryTime,
    exit_time: exit.time,
    pnl: round2(pnl),
    pnl_percent: round2((pnl / (position.entryPrice * position.quantity)) * 100),
    exit_reason: exit.reason,
  };
}

function buildSummary({ trades, equityCurve, initialEquity, finalEquity }) {
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);

  return {
    total_trades: trades.length,
    win_count: wins.length,
    loss_count: losses.length,
    win_rate: trades.length ? round2((wins.length / trades.length) * 100) : null,
    avg_win: wins.length ? round2(wins.reduce((a, t) => a + t.pnl, 0) / wins.length) : null,
    avg_loss: losses.length ? round2(losses.reduce((a, t) => a + t.pnl, 0) / losses.length) : null,
    total_return_pct: round2(((finalEquity - initialEquity) / initialEquity) * 100),
    max_drawdown_pct: calculateMaxDrawdown(equityCurve, initialEquity),
    initial_equity: initialEquity,
    final_equity: round2(finalEquity),
  };
}

function calculateMaxDrawdown(equityCurve, initialEquity) {
  let peak = initialEquity;
  let maxDrawdown = 0;

  for (const point of equityCurve) {
    if (point.equity > peak) peak = point.equity;
    const drawdown = (peak - point.equity) / peak;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  return round2(maxDrawdown * 100);
}

function round2(v) { return parseFloat(v.toFixed(2)); }

module.exports = { runBacktest };
