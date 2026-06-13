const request = require('supertest');
const express = require('express');
const { generateAccessToken } = require('../../middleware/auth');

const mockDb = {
  one: jest.fn(),
  oneOrNone: jest.fn(),
  manyOrNone: jest.fn(),
  none: jest.fn(),
};
const mockGetCurrentPrice = jest.fn();
const mockGetHistoricalData = jest.fn();
const mockCalculateAll = jest.fn();
const mockGenerateSignal = jest.fn();

jest.mock('../../config/database', () => ({ db: mockDb }));
jest.mock('../../services/marketData', () => ({
  getCurrentPrice: mockGetCurrentPrice,
  getHistoricalData: mockGetHistoricalData,
}));
jest.mock('../../services/indicators', () => ({ calculateAll: mockCalculateAll }));
jest.mock('../../services/aiAnalysis', () => ({ generateSignal: mockGenerateSignal }));

const router = require('../../routes/analysis');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/analysis', router);
  app.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}

const USER_ID = 'user-uuid-456';
const userToken = generateAccessToken({ id: USER_ID, email: 'test@test.com', role: 'user' });
const authHeader = `Bearer ${userToken}`;

const MOCK_PRICE = {
  symbol: 'AAPL', price: 150.00, current_price: 150.00,
  previous_close: 148.50, candles: [{ time: '2024-01-01T00:00:00Z', open: 149, high: 151, low: 148, close: 150, volume: 1e6 }],
};
const MOCK_CANDLES = Array.from({ length: 10 }, (_, i) => ({
  open: 149 + i, high: 151 + i, low: 148 + i, close: 150 + i, volume: 1_000_000,
}));
const MOCK_HIST = { candles: MOCK_CANDLES, symbol: 'AAPL', current_price: 150 };
const MOCK_INDICATORS = { rsi_14: 62, sma_20: 148, current_price: 150 };
const MOCK_SIGNAL = {
  id: 'sig-uuid',
  user_id: USER_ID,
  symbol: 'AAPL',
  timeframe: '1h',
  signal: 'buy',
  confidence: 72,
  reasoning: 'Bullish momentum.',
  entry_price: 150,
  created_at: new Date().toISOString(),
  cached: false,
};

beforeEach(() => {
  jest.resetAllMocks();
  mockDb.none.mockResolvedValue(undefined);
  mockGetCurrentPrice.mockResolvedValue(MOCK_PRICE);
  mockGetHistoricalData.mockResolvedValue(MOCK_HIST);
  mockCalculateAll.mockReturnValue(MOCK_INDICATORS);
  mockGenerateSignal.mockResolvedValue(MOCK_SIGNAL);
});

const app = createApp();

describe('POST /api/analysis/generate', () => {
  test('returns 401 without auth token', async () => {
    const res = await request(app).post('/api/analysis/generate').send({ symbol: 'AAPL' });
    expect(res.status).toBe(401);
  });

  test('returns AI signal for valid request', async () => {
    const res = await request(app)
      .post('/api/analysis/generate')
      .set('Authorization', authHeader)
      .send({ symbol: 'AAPL', timeframe: '1h' });
    expect(res.status).toBe(200);
    expect(res.body.signal.signal).toBe('buy');
    expect(res.body.signal.confidence).toBe(72);
  });

  test('returns 400 for missing symbol', async () => {
    const res = await request(app)
      .post('/api/analysis/generate')
      .set('Authorization', authHeader)
      .send({ timeframe: '1h' });
    expect(res.status).toBe(400);
  });

  test('returns 400 for invalid timeframe', async () => {
    const res = await request(app)
      .post('/api/analysis/generate')
      .set('Authorization', authHeader)
      .send({ symbol: 'AAPL', timeframe: '3h' });
    expect(res.status).toBe(400);
  });

  test('returns 404 when no candle data available', async () => {
    mockGetHistoricalData.mockResolvedValueOnce({ candles: [] });
    const res = await request(app)
      .post('/api/analysis/generate')
      .set('Authorization', authHeader)
      .send({ symbol: 'AAPL' });
    expect(res.status).toBe(404);
  });

  test('defaults timeframe to 1h', async () => {
    await request(app)
      .post('/api/analysis/generate')
      .set('Authorization', authHeader)
      .send({ symbol: 'AAPL' });
    expect(mockGetHistoricalData).toHaveBeenCalledWith('AAPL', '1h', 250);
  });
});

describe('GET /api/analysis/signals', () => {
  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/analysis/signals');
    expect(res.status).toBe(401);
  });

  test('returns paginated list of signals', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce([MOCK_SIGNAL]);
    mockDb.one.mockResolvedValueOnce({ count: '1' });
    const res = await request(app)
      .get('/api/analysis/signals')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.signals)).toBe(true);
    expect(res.body.total).toBe(1);
  });

  test('filters by symbol', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce([]);
    mockDb.one.mockResolvedValueOnce({ count: '0' });
    const res = await request(app)
      .get('/api/analysis/signals?symbol=AAPL')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
  });

  test('returns 400 for invalid timeframe filter', async () => {
    const res = await request(app)
      .get('/api/analysis/signals?timeframe=invalid')
      .set('Authorization', authHeader);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/analysis/signals/:id', () => {
  test('returns signal by ID', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(MOCK_SIGNAL);
    const res = await request(app)
      .get('/api/analysis/signals/sig-uuid')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body.signal.signal).toBe('buy');
  });

  test('returns 404 for unknown signal', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    const res = await request(app)
      .get('/api/analysis/signals/nonexistent')
      .set('Authorization', authHeader);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/analysis/performance', () => {
  test('returns performance stats', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce([{ signal_type: 'buy', total: '5', avg_confidence: '65' }]);
    mockDb.one.mockResolvedValueOnce({ total_signals: '10', avg_confidence: '63', executed: '3', total_tokens_used: '5000' });
    const res = await request(app)
      .get('/api/analysis/performance')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('by_type');
    expect(res.body).toHaveProperty('overall');
  });
});

describe('GET /api/analysis/latest/:symbol', () => {
  test('returns cached signal for symbol', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce({
      symbol: 'AAPL', signal_data: MOCK_SIGNAL, updated_at: new Date().toISOString(),
    });
    const res = await request(app)
      .get('/api/analysis/latest/AAPL')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body.symbol).toBe('AAPL');
    expect(res.body.signal).toBeDefined();
  });

  test('returns 404 when no cached signal exists', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    const res = await request(app)
      .get('/api/analysis/latest/TSLA')
      .set('Authorization', authHeader);
    expect(res.status).toBe(404);
  });
});
