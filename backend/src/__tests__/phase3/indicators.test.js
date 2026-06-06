const { sma, ema, rsi, macd, bollingerBands, vwap, stochastic, atr, calculateAll } = require('../../services/indicators');

function makeCloses(n, start = 100, step = 0.5) {
  return Array.from({ length: n }, (_, i) => parseFloat((start + i * step + Math.sin(i * 0.3) * 0.2).toFixed(6)));
}

function makeCandles(n, start = 100) {
  return makeCloses(n, start).map((c, i) => ({
    open: c - 0.5, high: c + 1, low: c - 1, close: c, volume: 1_000_000 + i * 1000,
  }));
}

describe('SMA', () => {
  test('computes average of last N values', () => {
    expect(sma([10, 20, 30, 40, 50], 3)).toBeCloseTo(40, 5);
  });
  test('uses only last N values', () => {
    expect(sma([100, 200, 300], 2)).toBeCloseTo(250, 5);
  });
  test('returns null when length < period', () => {
    expect(sma([10, 20], 3)).toBeNull();
  });
  test('handles period equal to length', () => {
    expect(sma([10, 20, 30], 3)).toBeCloseTo(20, 5);
  });
  test('handles period 1', () => {
    expect(sma([42], 1)).toBeCloseTo(42, 5);
  });
});

describe('EMA', () => {
  test('returns seed value for exact period', () => {
    expect(ema([10, 20], 2)).toBeCloseTo(15, 5);
  });
  test('returns null when insufficient data', () => {
    expect(ema([10, 20], 3)).toBeNull();
  });
  test('converges to constant for flat series', () => {
    expect(ema(new Array(50).fill(100), 12)).toBeCloseTo(100, 2);
  });
  test('rising EMA for upward trend', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(ema(closes, 12)).toBeGreaterThan(100);
  });
  test('EMA > SMA for accelerating uptrend', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i * i * 0.1);
    const ema12 = ema(closes, 12);
    const sma12 = sma(closes, 12);
    expect(ema12).toBeGreaterThan(sma12);
  });
});

describe('RSI', () => {
  test('returns 100 for all-gain series', () => {
    const closes = Array.from({ length: 15 }, (_, i) => 100 + i);
    expect(rsi(closes, 14)).toBe(100);
  });
  test('returns ~50 for alternating series', () => {
    const closes = Array.from({ length: 15 }, (_, i) => i % 2 === 0 ? 100 : 101);
    expect(rsi(closes, 14)).toBeCloseTo(50, 0);
  });
  test('returns null when insufficient data', () => {
    expect(rsi([100, 101, 102], 14)).toBeNull();
  });
  test('returns value between 0 and 100', () => {
    const r = rsi(makeCloses(30), 14);
    if (r !== null) {
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(100);
    }
  });
  test('accepts custom period', () => {
    const closes = Array.from({ length: 12 }, (_, i) => 100 + i);
    expect(rsi(closes, 10)).not.toBeNull();
  });
});

describe('MACD', () => {
  test('returns null for 34 or fewer closes', () => {
    expect(macd(new Array(34).fill(100))).toBeNull();
  });
  test('returns zero MACD for flat series', () => {
    const result = macd(new Array(40).fill(100));
    expect(result).not.toBeNull();
    expect(result.macd).toBeCloseTo(0, 4);
    expect(result.signal).toBeCloseTo(0, 4);
    expect(result.histogram).toBeCloseTo(0, 4);
  });
  test('returns object with required keys', () => {
    const result = macd(makeCloses(50));
    expect(result).toHaveProperty('macd');
    expect(result).toHaveProperty('signal');
    expect(result).toHaveProperty('histogram');
  });
  test('histogram equals macd minus signal', () => {
    const result = macd(makeCloses(50));
    if (result) {
      expect(result.histogram).toBeCloseTo(result.macd - result.signal, 4);
    }
  });
  test('35 closes is enough (boundary)', () => {
    expect(macd(new Array(35).fill(100))).not.toBeNull();
  });
});

describe('Bollinger Bands', () => {
  test('returns null for fewer than 20 closes', () => {
    expect(bollingerBands(new Array(19).fill(100))).toBeNull();
  });
  test('zero bandwidth and equal bands for flat series', () => {
    const b = bollingerBands(new Array(20).fill(100));
    expect(b.upper).toBeCloseTo(100, 4);
    expect(b.lower).toBeCloseTo(100, 4);
    expect(b.bandwidth).toBeCloseTo(0, 4);
  });
  test('upper > middle > lower for volatile series', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + (i % 5) * 3);
    const b = bollingerBands(closes);
    expect(b.upper).toBeGreaterThan(b.middle);
    expect(b.middle).toBeGreaterThan(b.lower);
  });
  test('bandwidth is positive for volatile series', () => {
    const closes = Array.from({ length: 25 }, (_, i) => 100 + (i % 3) * 5);
    expect(bollingerBands(closes).bandwidth).toBeGreaterThan(0);
  });
});

describe('VWAP', () => {
  test('computes from single candle', () => {
    const candles = [{ high: 110, low: 90, close: 100, volume: 1000 }];
    expect(vwap(candles)).toBeCloseTo(100, 4);
  });
  test('returns null for empty candles', () => {
    expect(vwap([])).toBeNull();
  });
  test('weights higher-volume candles more', () => {
    const candles = [
      { high: 100, low: 80, close: 90, volume: 100 },
      { high: 150, low: 130, close: 140, volume: 900 },
    ];
    const result = vwap(candles);
    expect(result).toBeGreaterThan(120);
  });
  test('returns null for candles without volume', () => {
    const candles = [{ high: 110, low: 90, close: 100 }];
    expect(vwap(candles)).toBeNull();
  });
});

describe('Stochastic', () => {
  test('returns null for fewer than 14 candles', () => {
    expect(stochastic(new Array(13).fill({ high: 105, low: 95, close: 100 }))).toBeNull();
  });
  test('returns 50 when close is at midpoint', () => {
    const candles = new Array(14).fill({ high: 110, low: 90, close: 100 });
    expect(stochastic(candles).k).toBeCloseTo(50, 2);
  });
  test('returns 100 when close equals high', () => {
    const candles = new Array(14).fill({ high: 100, low: 90, close: 100 });
    expect(stochastic(candles).k).toBeCloseTo(100, 2);
  });
  test('returns 0 when close equals low', () => {
    const candles = new Array(14).fill({ high: 110, low: 90, close: 90 });
    expect(stochastic(candles).k).toBeCloseTo(0, 2);
  });
  test('returns object with k and d', () => {
    const candles = makeCandles(20);
    const s = stochastic(candles);
    expect(s).toHaveProperty('k');
    expect(s).toHaveProperty('d');
  });
});

describe('ATR', () => {
  test('returns null for fewer than 15 candles', () => {
    expect(atr(new Array(14).fill({ high: 102, low: 98, close: 100 }))).toBeNull();
  });
  test('computes correct ATR for uniform candles', () => {
    const candles = new Array(20).fill({ high: 102, low: 98, close: 100 });
    expect(atr(candles)).toBeCloseTo(4, 2);
  });
  test('ATR is positive', () => {
    expect(atr(makeCandles(20))).toBeGreaterThan(0);
  });
  test('higher volatility yields higher ATR', () => {
    const stable = new Array(20).fill({ high: 101, low: 99, close: 100 });
    const volatile = new Array(20).fill({ high: 110, low: 90, close: 100 });
    expect(atr(volatile)).toBeGreaterThan(atr(stable));
  });
});

describe('calculateAll()', () => {
  test('returns empty object for empty candles', () => {
    expect(calculateAll([])).toEqual({});
  });
  test('returns empty object for single candle', () => {
    expect(calculateAll([{ close: 100 }])).toEqual({});
  });
  test('returns current_price and price_change_pct for minimal data', () => {
    const candles = makeCandles(5);
    const result = calculateAll(candles);
    expect(result.current_price).toBe(candles[candles.length - 1].close);
    expect(typeof result.price_change_pct).toBe('number');
  });
  test('all indicators populated for 250 candles', () => {
    const candles = makeCandles(250);
    const result = calculateAll(candles);
    expect(result.sma_20).not.toBeNull();
    expect(result.sma_50).not.toBeNull();
    expect(result.ema_12).not.toBeNull();
    expect(result.ema_26).not.toBeNull();
    expect(result.rsi_14).not.toBeNull();
    expect(result.macd).not.toBeNull();
    expect(result.bollinger_bands).not.toBeNull();
    expect(result.vwap).not.toBeNull();
    expect(result.stochastic).not.toBeNull();
    expect(result.atr_14).not.toBeNull();
  });
  test('sma_200 is null for fewer than 200 candles', () => {
    const candles = makeCandles(50);
    expect(calculateAll(candles).sma_200).toBeNull();
  });
  test('bollinger_bands has upper/middle/lower fields', () => {
    const result = calculateAll(makeCandles(50));
    if (result.bollinger_bands) {
      expect(result.bollinger_bands).toHaveProperty('upper');
      expect(result.bollinger_bands).toHaveProperty('middle');
      expect(result.bollinger_bands).toHaveProperty('lower');
    }
  });
});
