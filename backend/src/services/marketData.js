const axios = require('axios');
const { cacheGet, cacheSet } = require('../config/redis');

const YF_BASE = 'https://query1.finance.yahoo.com';
const YF_BASE2 = 'https://query2.finance.yahoo.com';

const INTERVAL_MAP = {
  '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '60m', '4h': '4h', '1d': '1d', '1w': '1wk', '1mo': '1mo',
};

const RANGE_MAP = {
  '1m': '1d', '5m': '5d', '15m': '1mo', '30m': '1mo',
  '1h': '3mo', '4h': '6mo', '1d': '2y', '1w': '5y', '1mo': '10y',
};

async function fetchYahoo(symbol, interval = '1h', bars = 200) {
  const yInterval = INTERVAL_MAP[interval] || '60m';
  const range = RANGE_MAP[interval] || '3mo';

  const url = `${YF_BASE}/v8/finance/chart/${encodeURIComponent(symbol)}`;
  const params = { interval: yInterval, range, includePrePost: false };

  try {
    const { data } = await axios.get(url, { params, timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    return parseYahooChart(data, bars);
  } catch (err1) {
    // Try alternate host
    try {
      const url2 = `${YF_BASE2}/v8/finance/chart/${encodeURIComponent(symbol)}`;
      const { data } = await axios.get(url2, { params, timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      return parseYahooChart(data, bars);
    } catch (err2) {
      throw Object.assign(new Error(`Market data unavailable for ${symbol}: ${err2.message}`), { status: 502 });
    }
  }
}

function parseYahooChart(data, bars) {
  const result = data?.chart?.result?.[0];
  if (!result) throw Object.assign(new Error('No chart data returned'), { status: 502 });

  const { meta, timestamp, indicators } = result;
  const quote = indicators?.quote?.[0] || {};
  const adjClose = indicators?.adjclose?.[0]?.adjclose;

  if (!timestamp || !quote.close) throw Object.assign(new Error('Incomplete chart data'), { status: 502 });

  const candles = timestamp.map((ts, i) => ({
    timestamp: ts * 1000,
    time: new Date(ts * 1000).toISOString(),
    open: quote.open?.[i] ?? null,
    high: quote.high?.[i] ?? null,
    low: quote.low?.[i] ?? null,
    close: quote.close?.[i] ?? null,
    volume: quote.volume?.[i] ?? null,
    adj_close: adjClose?.[i] ?? null,
  })).filter(c => c.close !== null);

  return {
    symbol: meta.symbol,
    currency: meta.currency,
    exchange: meta.exchangeName,
    type: meta.instrumentType,
    current_price: meta.regularMarketPrice,
    previous_close: meta.chartPreviousClose,
    candles: candles.slice(-bars),
  };
}

async function getCurrentPrice(symbol) {
  const cacheKey = `price:${symbol}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const url = `${YF_BASE}/v8/finance/chart/${encodeURIComponent(symbol)}`;
  const { data } = await axios.get(url, {
    params: { interval: '1m', range: '1d' },
    timeout: 5000,
    headers: { 'User-Agent': 'Mozilla/5.0' },
  }).catch(async () => {
    const url2 = `${YF_BASE2}/v8/finance/chart/${encodeURIComponent(symbol)}`;
    return axios.get(url2, { params: { interval: '1m', range: '1d' }, timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } });
  });

  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta) throw Object.assign(new Error(`Symbol not found: ${symbol}`), { status: 404 });

  const priceData = {
    symbol: meta.symbol,
    price: meta.regularMarketPrice,
    open: meta.regularMarketOpen,
    high: meta.regularMarketDayHigh,
    low: meta.regularMarketDayLow,
    previous_close: meta.chartPreviousClose,
    change: meta.regularMarketPrice - meta.chartPreviousClose,
    change_percent: ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose * 100).toFixed(2),
    volume: meta.regularMarketVolume,
    market_cap: meta.marketCap,
    currency: meta.currency,
    exchange: meta.exchangeName,
    timestamp: new Date().toISOString(),
  };

  await cacheSet(cacheKey, priceData, 60); // 60-second cache for live prices
  return priceData;
}

async function getHistoricalData(symbol, interval = '1h', bars = 200) {
  const cacheKey = `hist:${symbol}:${interval}:${bars}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const result = await fetchYahoo(symbol, interval, bars);

  const ttl = interval === '1m' ? 60 : interval === '5m' ? 300 : interval === '1h' ? 900 : 3600;
  await cacheSet(cacheKey, result, ttl);

  return result;
}

async function searchSymbols(query) {
  const cacheKey = `search:${query.toLowerCase()}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const url = `${YF_BASE}/v1/finance/search`;
  const { data } = await axios.get(url, {
    params: { q: query, quotesCount: 15, newsCount: 0 },
    timeout: 5000,
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });

  const results = (data?.quotes || []).map(q => ({
    symbol: q.symbol,
    name: q.shortname || q.longname,
    exchange: q.exchange,
    type: q.quoteType,
    score: q.score,
  }));

  await cacheSet(cacheKey, results, 300);
  return results;
}

module.exports = { getCurrentPrice, getHistoricalData, searchSymbols };
