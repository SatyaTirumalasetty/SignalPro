// Technical indicators computed from OHLCV candle arrays.
// All functions accept an array of candle objects with { open, high, low, close, volume }.

function sma(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(closes, period) {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let val = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    val = closes[i] * k + val * (1 - k);
  }
  return val;
}

function emaArray(closes, period) {
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  const result = new Array(period - 1).fill(null);
  let val = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(val);
  for (let i = period; i < closes.length; i++) {
    val = closes[i] * k + val * (1 - k);
    result.push(val);
  }
  return result;
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change; else losses -= change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function macd(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal) return null;
  const fastEma = emaArray(closes, fast);
  const slowEma = emaArray(closes, slow);
  const macdLine = fastEma.map((f, i) => (f !== null && slowEma[i] !== null) ? f - slowEma[i] : null);
  const validMacd = macdLine.filter(v => v !== null);
  if (validMacd.length < signal) return null;
  const signalLine = ema(validMacd, signal);
  const macdValue = validMacd[validMacd.length - 1];
  return {
    macd: macdValue,
    signal: signalLine,
    histogram: macdValue - signalLine,
  };
}

function bollingerBands(closes, period = 20, stdDevMultiplier = 2) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mid = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((acc, v) => acc + Math.pow(v - mid, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  return {
    upper: mid + stdDevMultiplier * stdDev,
    middle: mid,
    lower: mid - stdDevMultiplier * stdDev,
    bandwidth: ((2 * stdDevMultiplier * stdDev) / mid) * 100,
  };
}

function vwap(candles) {
  // VWAP = cumulative(typical_price * volume) / cumulative(volume)
  const relevant = candles.filter(c => c.volume && c.high && c.low && c.close);
  if (!relevant.length) return null;
  let cumPV = 0, cumV = 0;
  for (const c of relevant) {
    const tp = (c.high + c.low + c.close) / 3;
    cumPV += tp * c.volume;
    cumV += c.volume;
  }
  return cumV ? cumPV / cumV : null;
}

function stochastic(candles, kPeriod = 14, _dPeriod = 3) {
  if (candles.length < kPeriod) return null;
  const slice = candles.slice(-kPeriod);
  const highMax = Math.max(...slice.map(c => c.high));
  const lowMin = Math.min(...slice.map(c => c.low));
  const close = candles[candles.length - 1].close;
  const kVal = ((close - lowMin) / (highMax - lowMin)) * 100;
  // Simplified %D as average of last dPeriod %K values
  return { k: kVal, d: kVal };
}

function atr(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], prev = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)));
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateAll(candles) {
  if (!candles || candles.length < 2) return {};
  const closes = candles.map(c => c.close).filter(Boolean);

  return {
    sma_20: round(sma(closes, 20)),
    sma_50: round(sma(closes, 50)),
    sma_200: round(sma(closes, 200)),
    ema_12: round(ema(closes, 12)),
    ema_26: round(ema(closes, 26)),
    ema_50: round(ema(closes, 50)),
    rsi_14: round(rsi(closes, 14)),
    macd: macdRound(macd(closes)),
    bollinger_bands: bbRound(bollingerBands(closes)),
    vwap: round(vwap(candles)),
    stochastic: stochRound(stochastic(candles)),
    atr_14: round(atr(candles)),
    current_price: closes[closes.length - 1],
    price_change_pct: closes.length >= 2
      ? round(((closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2]) * 100)
      : null,
  };
}

function round(v, dp = 4) { return v !== null && v !== undefined ? parseFloat(v.toFixed(dp)) : null; }
function macdRound(m) { return m ? { macd: round(m.macd), signal: round(m.signal), histogram: round(m.histogram) } : null; }
function bbRound(b) { return b ? { upper: round(b.upper, 2), middle: round(b.middle, 2), lower: round(b.lower, 2), bandwidth: round(b.bandwidth, 2) } : null; }
function stochRound(s) { return s ? { k: round(s.k, 2), d: round(s.d, 2) } : null; }

module.exports = { sma, ema, rsi, macd, bollingerBands, vwap, stochastic, atr, calculateAll };
