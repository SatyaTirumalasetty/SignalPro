// Regenerates the frontend indicator parity fixture from the backend math.
// Run: npm run gen:indicator-fixtures  (from backend/)
const fs = require('fs');
const path = require('path');
const { calculateAll } = require('../src/services/indicators');

// Deterministic pseudo-random walk (no Math.random) so the fixture is stable.
function makeCandles(n = 250) {
  const candles = [];
  let price = 100;
  let seed = 42;
  const rand = () => {
    // xorshift32
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return ((seed >>> 0) % 1000) / 1000; // [0,1)
  };
  const t0 = 1760000000000;
  for (let i = 0; i < n; i++) {
    const drift = (rand() - 0.48) * 2;
    const open = price;
    const close = +(price + drift).toFixed(4);
    const high = +(Math.max(open, close) + rand()).toFixed(4);
    const low = +(Math.min(open, close) - rand()).toFixed(4);
    const volume = 1000 + Math.floor(rand() * 9000);
    candles.push({ timestamp: t0 + i * 3600000, time: new Date(t0 + i * 3600000).toISOString(), open, high, low, close, volume });
    price = close;
  }
  return candles;
}

const candles = makeCandles();
const all = calculateAll(candles);
const fixture = {
  candles,
  expected: {
    sma_20: all.sma_20,
    sma_50: all.sma_50,
    ema_12: all.ema_12,
    ema_26: all.ema_26,
    rsi_14: all.rsi_14,
    macd: all.macd,
    bollinger_bands: { upper: all.bollinger_bands.upper, middle: all.bollinger_bands.middle, lower: all.bollinger_bands.lower },
    vwap: all.vwap,
    atr_14: all.atr_14,
    stochastic: { k: all.stochastic.k },
  },
};

const outPath = path.join(__dirname, '..', '..', 'frontend', 'src', 'lib', 'indicators', '__fixtures__', 'parity.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(fixture, null, 1));
console.log(`Wrote ${outPath} (${candles.length} candles)`);
