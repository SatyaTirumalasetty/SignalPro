jest.mock('axios');
jest.mock('../../config/redis', () => ({
  cacheGet: jest.fn().mockResolvedValue(null),
  cacheSet: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/alpacaMarketData', () => ({
  isConfigured: jest.fn(),
  getLatestQuotes: jest.fn(),
}));

const axios = require('axios');
const { cacheGet, cacheSet } = require('../../config/redis');
const alpacaMarketData = require('../../services/alpacaMarketData');
const { getCurrentPrice, getLiveQuote, getHistoricalData, searchSymbols } = require('../../services/marketData');

const MOCK_META = {
  symbol: 'AAPL',
  currency: 'USD',
  exchangeName: 'NASDAQ',
  instrumentType: 'EQUITY',
  regularMarketPrice: 150.00,
  chartPreviousClose: 148.50,
  regularMarketOpen: 149.00,
  regularMarketDayHigh: 151.00,
  regularMarketDayLow: 148.00,
  regularMarketVolume: 50_000_000,
  marketCap: 2_500_000_000_000,
};

const MOCK_CHART_RESPONSE = {
  data: {
    chart: {
      result: [{
        meta: MOCK_META,
        timestamp: [1700000000, 1700003600, 1700007200],
        indicators: {
          quote: [{
            open:   [149.0, 149.5, 150.0],
            high:   [150.5, 150.8, 151.0],
            low:    [148.5, 149.0, 149.5],
            close:  [150.0, 150.5, 151.0],
            volume: [1_000_000, 1_100_000, 900_000],
          }],
          adjclose: [{ adjclose: [150.0, 150.5, 151.0] }],
        },
      }],
    },
  },
};

const MOCK_SEARCH_RESPONSE = {
  data: {
    quotes: [
      { symbol: 'AAPL', shortname: 'Apple Inc.', exchange: 'NMS', quoteType: 'EQUITY', score: 1729916 },
      { symbol: 'AAPL.BA', longname: 'Apple Inc.', exchange: 'BUE', quoteType: 'EQUITY', score: 1000000 },
    ],
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  cacheGet.mockResolvedValue(null);
  cacheSet.mockResolvedValue(undefined);
  alpacaMarketData.isConfigured.mockReturnValue(false);
});

describe('getCurrentPrice()', () => {
  test('returns price data for valid symbol', async () => {
    axios.get.mockResolvedValueOnce(MOCK_CHART_RESPONSE);
    const data = await getCurrentPrice('AAPL');
    expect(data.symbol).toBe('AAPL');
    expect(data.price).toBe(150.00);
    expect(data.currency).toBe('USD');
    expect(data.exchange).toBe('NASDAQ');
    expect(data.previous_close).toBe(148.50);
  });

  test('computes change and change_percent correctly', async () => {
    axios.get.mockResolvedValueOnce(MOCK_CHART_RESPONSE);
    const data = await getCurrentPrice('AAPL');
    expect(data.change).toBeCloseTo(150.00 - 148.50, 4);
    expect(parseFloat(data.change_percent)).toBeCloseTo(((150.00 - 148.50) / 148.50) * 100, 1);
  });

  test('returns cached result when available', async () => {
    const cached = { symbol: 'AAPL', price: 155.00 };
    cacheGet.mockResolvedValueOnce(cached);
    const data = await getCurrentPrice('AAPL');
    expect(data).toEqual(cached);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('caches result after API call', async () => {
    axios.get.mockResolvedValueOnce(MOCK_CHART_RESPONSE);
    await getCurrentPrice('AAPL');
    expect(cacheSet).toHaveBeenCalledWith('price:AAPL', expect.any(Object), 60);
  });

  test('falls back to query2 when query1 fails', async () => {
    axios.get
      .mockRejectedValueOnce(new Error('query1 failed'))
      .mockResolvedValueOnce(MOCK_CHART_RESPONSE);
    const data = await getCurrentPrice('AAPL');
    expect(data.price).toBe(150.00);
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  test('throws when both hosts fail', async () => {
    axios.get.mockRejectedValue(new Error('network error'));
    await expect(getCurrentPrice('AAPL')).rejects.toThrow();
  });

  test('throws when chart result is empty', async () => {
    axios.get.mockResolvedValueOnce({ data: { chart: { result: null } } });
    await expect(getCurrentPrice('AAPL')).rejects.toThrow();
  });
});

describe('getLiveQuote()', () => {
  test('returns Alpaca quote when configured and available', async () => {
    alpacaMarketData.isConfigured.mockReturnValue(true);
    alpacaMarketData.getLatestQuotes.mockResolvedValueOnce({
      AAPL: { price: 150.25, bid: 150.20, ask: 150.30, timestamp: '2024-01-01T00:00:00Z' },
    });

    const quote = await getLiveQuote('AAPL');
    expect(quote).toEqual({
      symbol: 'AAPL',
      source: 'alpaca',
      price: 150.25,
      bid: 150.20,
      ask: 150.30,
      timestamp: '2024-01-01T00:00:00Z',
    });
  });

  test('falls back to Yahoo when Alpaca is configured but has no data', async () => {
    alpacaMarketData.isConfigured.mockReturnValue(true);
    alpacaMarketData.getLatestQuotes.mockResolvedValueOnce({});
    axios.get.mockResolvedValueOnce(MOCK_CHART_RESPONSE);

    const quote = await getLiveQuote('AAPL');
    expect(quote.source).toBe('yahoo');
    expect(quote.price).toBe(150.00);
    expect(quote.bid).toBeNull();
    expect(quote.ask).toBeNull();
  });

  test('falls back to Yahoo when Alpaca is not configured', async () => {
    alpacaMarketData.isConfigured.mockReturnValue(false);
    axios.get.mockResolvedValueOnce(MOCK_CHART_RESPONSE);

    const quote = await getLiveQuote('AAPL');
    expect(quote.source).toBe('yahoo');
    expect(alpacaMarketData.getLatestQuotes).not.toHaveBeenCalled();
    expect(quote.symbol).toBe('AAPL');
  });
});

describe('getHistoricalData()', () => {
  test('returns candles for valid symbol', async () => {
    axios.get.mockResolvedValueOnce(MOCK_CHART_RESPONSE);
    const data = await getHistoricalData('AAPL', '1h', 200);
    expect(data.symbol).toBe('AAPL');
    expect(Array.isArray(data.candles)).toBe(true);
    expect(data.candles.length).toBeGreaterThan(0);
  });

  test('candles have required OHLCV fields', async () => {
    axios.get.mockResolvedValueOnce(MOCK_CHART_RESPONSE);
    const data = await getHistoricalData('AAPL', '1h', 200);
    const c = data.candles[0];
    expect(c).toHaveProperty('timestamp');
    expect(c).toHaveProperty('open');
    expect(c).toHaveProperty('high');
    expect(c).toHaveProperty('low');
    expect(c).toHaveProperty('close');
    expect(c).toHaveProperty('volume');
  });

  test('returns cached data when available', async () => {
    const cached = { symbol: 'AAPL', candles: [{ close: 150 }] };
    cacheGet.mockResolvedValueOnce(cached);
    const data = await getHistoricalData('AAPL', '1h', 200);
    expect(data).toEqual(cached);
    expect(axios.get).not.toHaveBeenCalled();
  });

  // Yahoo's `chartPreviousClose` is the close preceding the *requested range*,
  // not the prior session. Intraday intervals request a wide range (1h => 3mo),
  // so it is months stale; `previousClose` is the true prior session close.
  test('uses the prior session close, not the range-boundary close', async () => {
    const response = JSON.parse(JSON.stringify(MOCK_CHART_RESPONSE));
    response.data.chart.result[0].meta = {
      ...MOCK_META,
      regularMarketPrice: 333.74,
      previousClose: 333.26,      // true prior session close
      chartPreviousClose: 270.23, // close from ~3mo ago (start of range)
    };
    axios.get.mockResolvedValueOnce(response);
    const data = await getHistoricalData('AAPL', '1h', 200);
    expect(data.previous_close).toBe(333.26);
  });

  test('falls back to chartPreviousClose when previousClose is absent', async () => {
    axios.get.mockResolvedValueOnce(MOCK_CHART_RESPONSE);
    const data = await getHistoricalData('AAPL', '1h', 200);
    expect(data.previous_close).toBe(148.50);
  });

  test('filters null-close candles', async () => {
    const responseWithNulls = {
      data: {
        chart: {
          result: [{
            meta: MOCK_META,
            timestamp: [1700000000, 1700003600],
            indicators: {
              quote: [{
                open: [149.0, null], high: [150.0, null],
                low: [148.5, null], close: [150.0, null], volume: [1_000_000, null],
              }],
              adjclose: [{ adjclose: [150.0, null] }],
            },
          }],
        },
      },
    };
    axios.get.mockResolvedValueOnce(responseWithNulls);
    const data = await getHistoricalData('AAPL', '1h', 200);
    expect(data.candles.every(c => c.close !== null)).toBe(true);
  });
});

describe('searchSymbols()', () => {
  test('returns array of results', async () => {
    axios.get.mockResolvedValueOnce(MOCK_SEARCH_RESPONSE);
    const results = await searchSymbols('apple');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(2);
  });

  test('result has required fields', async () => {
    axios.get.mockResolvedValueOnce(MOCK_SEARCH_RESPONSE);
    const results = await searchSymbols('apple');
    expect(results[0]).toHaveProperty('symbol', 'AAPL');
    expect(results[0]).toHaveProperty('exchange');
    expect(results[0]).toHaveProperty('type');
  });

  test('uses name fallback (longname) when shortname missing', async () => {
    axios.get.mockResolvedValueOnce(MOCK_SEARCH_RESPONSE);
    const results = await searchSymbols('apple');
    expect(results[1].name).toBe('Apple Inc.');
  });

  test('returns cached results', async () => {
    const cached = [{ symbol: 'AAPL', name: 'Apple Inc.' }];
    cacheGet.mockResolvedValueOnce(cached);
    const results = await searchSymbols('apple');
    expect(results).toEqual(cached);
    expect(axios.get).not.toHaveBeenCalled();
  });
});
