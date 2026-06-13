const request = require('supertest');
const express = require('express');

const mockGetCurrentPrice = jest.fn();
const mockGetLiveQuote = jest.fn();
const mockGetHistoricalData = jest.fn();
const mockSearchSymbols = jest.fn();
const mockCalculateAll = jest.fn();

jest.mock('../../services/marketData', () => ({
  getCurrentPrice: mockGetCurrentPrice,
  getLiveQuote: mockGetLiveQuote,
  getHistoricalData: mockGetHistoricalData,
  searchSymbols: mockSearchSymbols,
}));
jest.mock('../../services/indicators', () => ({
  calculateAll: mockCalculateAll,
}));

const router = require('../../routes/market');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/market', router);
  app.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}

const MOCK_PRICE = {
  symbol: 'AAPL', price: 150.00, open: 149.00, high: 151.00, low: 148.50,
  previous_close: 148.50, change: 1.50, change_percent: '1.01',
  volume: 50_000_000, currency: 'USD', exchange: 'NASDAQ', timestamp: new Date().toISOString(),
};

const MOCK_HIST = {
  symbol: 'AAPL', currency: 'USD', exchange: 'NASDAQ', type: 'EQUITY',
  current_price: 150.00, previous_close: 148.50,
  candles: Array.from({ length: 3 }, (_, i) => ({
    timestamp: 1700000000000 + i * 3600000,
    time: new Date(1700000000000 + i * 3600000).toISOString(),
    open: 149 + i * 0.5, high: 151 + i * 0.5, low: 148 + i * 0.5,
    close: 150 + i * 0.5, volume: 1_000_000,
  })),
};

const MOCK_INDICATORS = {
  sma_20: 148, ema_12: 149, rsi_14: 62, macd: { macd: 0.5, signal: 0.3, histogram: 0.2 },
  current_price: 150, price_change_pct: 0.5,
};

const MOCK_QUOTE = {
  symbol: 'AAPL', source: 'alpaca', price: 150.25, bid: 150.20, ask: 150.30, timestamp: new Date().toISOString(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetCurrentPrice.mockResolvedValue(MOCK_PRICE);
  mockGetLiveQuote.mockResolvedValue(MOCK_QUOTE);
  mockGetHistoricalData.mockResolvedValue(MOCK_HIST);
  mockSearchSymbols.mockResolvedValue([{ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NMS', type: 'EQUITY' }]);
  mockCalculateAll.mockReturnValue(MOCK_INDICATORS);
});

const app = createApp();

describe('GET /api/market/search', () => {
  test('returns results for valid query', async () => {
    const res = await request(app).get('/api/market/search?q=apple');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('results');
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.count).toBe(1);
  });

  test('returns 400 when q is missing', async () => {
    const res = await request(app).get('/api/market/search');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('errors');
  });

  test('calls searchSymbols with the query param', async () => {
    await request(app).get('/api/market/search?q=tesla');
    expect(mockSearchSymbols).toHaveBeenCalledWith('tesla');
  });

  test('propagates service errors', async () => {
    mockSearchSymbols.mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429 }));
    const res = await request(app).get('/api/market/search?q=apple');
    expect(res.status).toBe(429);
  });
});

describe('GET /api/market/price/:symbol', () => {
  test('returns price data for valid symbol', async () => {
    const res = await request(app).get('/api/market/price/AAPL');
    expect(res.status).toBe(200);
    expect(res.body.price.symbol).toBe('AAPL');
    expect(res.body.price.price).toBe(150.00);
  });

  test('calls getCurrentPrice with uppercase symbol', async () => {
    await request(app).get('/api/market/price/aapl');
    expect(mockGetCurrentPrice).toHaveBeenCalledWith('AAPL');
  });

  test('propagates 404 from service', async () => {
    mockGetCurrentPrice.mockRejectedValueOnce(Object.assign(new Error('not found'), { status: 404 }));
    const res = await request(app).get('/api/market/price/INVALID');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/market/quote/:symbol', () => {
  test('returns live quote for valid symbol', async () => {
    const res = await request(app).get('/api/market/quote/AAPL');
    expect(res.status).toBe(200);
    expect(res.body.quote.symbol).toBe('AAPL');
    expect(res.body.quote.source).toBe('alpaca');
  });

  test('calls getLiveQuote with uppercase symbol', async () => {
    await request(app).get('/api/market/quote/aapl');
    expect(mockGetLiveQuote).toHaveBeenCalledWith('AAPL');
  });

  test('propagates service errors', async () => {
    mockGetLiveQuote.mockRejectedValueOnce(Object.assign(new Error('not found'), { status: 404 }));
    const res = await request(app).get('/api/market/quote/INVALID');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/market/history/:symbol', () => {
  test('returns historical data', async () => {
    const res = await request(app).get('/api/market/history/AAPL');
    expect(res.status).toBe(200);
    expect(res.body.symbol).toBe('AAPL');
    expect(Array.isArray(res.body.data.candles)).toBe(true);
  });

  test('uses default interval 1h', async () => {
    await request(app).get('/api/market/history/AAPL');
    expect(mockGetHistoricalData).toHaveBeenCalledWith('AAPL', '1h', 200);
  });

  test('accepts custom interval and bars', async () => {
    await request(app).get('/api/market/history/AAPL?interval=1d&bars=50');
    expect(mockGetHistoricalData).toHaveBeenCalledWith('AAPL', '1d', 50);
  });

  test('rejects invalid interval', async () => {
    const res = await request(app).get('/api/market/history/AAPL?interval=invalid');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/market/indicators/:symbol', () => {
  test('returns indicator object', async () => {
    const res = await request(app).get('/api/market/indicators/AAPL');
    expect(res.status).toBe(200);
    expect(res.body.symbol).toBe('AAPL');
    expect(res.body.indicators).toEqual(MOCK_INDICATORS);
    expect(res.body.current_price).toBe(150.00);
    expect(res.body.calculated_at).toBeDefined();
  });

  test('calls getHistoricalData with 250 bars for indicator computation', async () => {
    await request(app).get('/api/market/indicators/AAPL');
    expect(mockGetHistoricalData).toHaveBeenCalledWith('AAPL', '1h', 250);
  });
});

describe('GET /api/market/snapshot/:symbol', () => {
  test('returns price, indicators and recent candles', async () => {
    const res = await request(app).get('/api/market/snapshot/AAPL');
    expect(res.status).toBe(200);
    expect(res.body.price).toBeDefined();
    expect(res.body.indicators).toBeDefined();
    expect(Array.isArray(res.body.recent_candles)).toBe(true);
    expect(res.body.calculated_at).toBeDefined();
  });

  test('fetches price and history in parallel', async () => {
    await request(app).get('/api/market/snapshot/AAPL');
    expect(mockGetCurrentPrice).toHaveBeenCalledWith('AAPL');
    expect(mockGetHistoricalData).toHaveBeenCalledWith('AAPL', '1h', 250);
  });

  test('recent_candles contains at most 10 entries', async () => {
    const longHist = { ...MOCK_HIST, candles: Array.from({ length: 50 }, (_, i) => ({ close: 150 + i })) };
    mockGetHistoricalData.mockResolvedValueOnce(longHist);
    const res = await request(app).get('/api/market/snapshot/AAPL');
    expect(res.body.recent_candles.length).toBeLessThanOrEqual(10);
  });
});
