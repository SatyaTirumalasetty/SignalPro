const axios = require('axios');
const { cacheGet, cacheSet } = require('../config/redis');
const logger = require('../config/logger');

const DATA_BASE = 'https://data.alpaca.markets';
const FEED = process.env.ALPACA_DATA_FEED || 'iex';

let client = null;

function isConfigured() {
  return !!(process.env.ALPACA_API_KEY && process.env.ALPACA_API_SECRET);
}

function getClient() {
  if (!client) {
    client = axios.create({
      baseURL: DATA_BASE,
      headers: {
        'APCA-API-KEY-ID': process.env.ALPACA_API_KEY,
        'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET,
      },
      timeout: 8000,
    });
  }
  return client;
}

// Latest quote + trade for a batch of symbols, keyed by symbol
async function getLatestQuotes(symbols) {
  if (!isConfigured() || symbols.length === 0) return {};

  const symbolList = symbols.join(',');
  try {
    const [quotesRes, tradesRes] = await Promise.all([
      getClient().get('/v2/stocks/quotes/latest', { params: { symbols: symbolList, feed: FEED } }),
      getClient().get('/v2/stocks/trades/latest', { params: { symbols: symbolList, feed: FEED } }),
    ]);

    const quotes = quotesRes.data?.quotes || {};
    const trades = tradesRes.data?.trades || {};

    const result = {};
    for (const symbol of symbols) {
      const q = quotes[symbol];
      const t = trades[symbol];
      if (!q && !t) continue;

      result[symbol] = {
        price: t?.p ?? (q ? (q.ap + q.bp) / 2 : null),
        bid: q?.bp ?? null,
        ask: q?.ap ?? null,
        bid_size: q?.bs ?? null,
        ask_size: q?.as ?? null,
        last_trade_size: t?.s ?? null,
        timestamp: t?.t || q?.t || new Date().toISOString(),
      };
    }
    return result;
  } catch (err) {
    logger.warn({ err: err.response?.data?.message || err.message }, 'Alpaca quote fetch failed');
    return {};
  }
}

// Recent news headlines for a set of symbols
async function getNews(symbols, limit = 5) {
  if (!isConfigured() || symbols.length === 0) return [];

  const cacheKey = `alpaca:news:${symbols.join(',')}:${limit}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const { data } = await getClient().get('/v1beta1/news', {
      params: { symbols: symbols.join(','), limit, sort: 'desc', exclude_contentless: true },
    });

    const news = (data?.news || []).map(n => ({
      id: n.id,
      headline: n.headline,
      summary: n.summary,
      source: n.source,
      url: n.url,
      symbols: n.symbols,
      created_at: n.created_at,
    }));

    await cacheSet(cacheKey, news, 600); // 10-minute cache
    return news;
  } catch (err) {
    logger.warn({ err: err.response?.data?.message || err.message }, 'Alpaca news fetch failed');
    return [];
  }
}

module.exports = { isConfigured, getLatestQuotes, getNews };
