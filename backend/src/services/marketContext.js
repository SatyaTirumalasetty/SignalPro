// Assembles the fused multi-timeframe context the decision prompt is built
// from. One context per symbol per cycle; indicators computed on the full
// fetched history, candles trimmed for the prompt.

const { getHistoricalData } = require('./marketData');
const { calculateAll } = require('./indicators');
const { getNews } = require('./alpacaMarketData');

const PROFILES = {
  trimmed: { maxTimeframes: 2, bars: 100, promptCandles: 5, newsItems: 0 },
  full: { maxTimeframes: 4, bars: 250, promptCandles: 20, newsItems: 5 },
};

async function buildMarketContext({ symbol, timeframes, contextProfile = 'full', position = null, portfolio = null }) {
  const profile = PROFILES[contextProfile] || PROFILES.full;
  const tfs = timeframes.slice(0, profile.maxTimeframes);

  const tfData = {};
  let current_price = null;
  let previous_close = null;
  for (const tf of tfs) {
    const hist = await getHistoricalData(symbol, tf, profile.bars);
    if (!hist.candles.length) continue;
    tfData[tf] = {
      candles: hist.candles.slice(-profile.promptCandles),
      indicators: calculateAll(hist.candles),
    };
    current_price = hist.current_price;
    previous_close = hist.previous_close;
  }
  if (!Object.keys(tfData).length) {
    throw new Error(`No market data available for ${symbol}`);
  }

  const news = profile.newsItems
    ? await getNews([symbol], profile.newsItems).catch(() => [])
    : [];

  return { symbol, current_price, previous_close, timeframes: tfData, news, position, portfolio };
}

// Lightweight per-symbol summary for the tiered-mode screening pass.
// Screening fails open: symbols we can't summarize are analyzed anyway.
async function buildScreeningSummaries(symbols, positionsBySymbol) {
  const summaries = [];
  const unscreenable = [];
  for (const symbol of symbols) {
    try {
      const hist = await getHistoricalData(symbol, '1h', 50);
      if (!hist.candles.length) throw new Error('no data');
      const indicators = calculateAll(hist.candles);
      summaries.push({
        symbol,
        current_price: hist.current_price,
        change_pct: +(((hist.current_price - hist.previous_close) / hist.previous_close) * 100).toFixed(2),
        rsi_14: indicators.rsi_14 ?? null,
        has_position: positionsBySymbol.has(symbol),
      });
    } catch {
      unscreenable.push(symbol);
    }
  }
  return { summaries, unscreenable };
}

module.exports = { buildMarketContext, buildScreeningSummaries };
