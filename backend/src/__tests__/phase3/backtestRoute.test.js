const request = require('supertest');
const express = require('express');
const { generateAccessToken } = require('../../middleware/auth');

const mockRunBacktest = jest.fn();
jest.mock('../../services/backtest', () => ({ runBacktest: mockRunBacktest }));

const router = require('../../routes/backtest');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/backtest', router);
  app.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}

const app = createApp();
const userToken = generateAccessToken({ id: 'user-1', email: 'trader@test.com', role: 'user' });
const auth = `Bearer ${userToken}`;

const MOCK_RESULT = {
  summary: { total_trades: 1, win_rate: 100, total_return_pct: 1.5, max_drawdown_pct: 0 },
  trades: [],
  equity_curve: [],
};

beforeEach(() => {
  jest.resetAllMocks();
  mockRunBacktest.mockResolvedValue(MOCK_RESULT);
});

describe('POST /api/backtest/run', () => {
  test('returns 401 without auth', async () => {
    const res = await request(app).post('/api/backtest/run').send({ symbol: 'AAPL' });
    expect(res.status).toBe(401);
  });

  test('returns 400 for missing symbol', async () => {
    const res = await request(app).post('/api/backtest/run').set('Authorization', auth).send({});
    expect(res.status).toBe(400);
  });

  test('runs a backtest and returns the result', async () => {
    const res = await request(app)
      .post('/api/backtest/run')
      .set('Authorization', auth)
      .send({ symbol: 'AAPL', timeframe: '1d', bars: 300 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(MOCK_RESULT);
    expect(mockRunBacktest).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'AAPL', timeframe: '1d', bars: 300 }));
  });

  test('rejects invalid timeframe', async () => {
    const res = await request(app)
      .post('/api/backtest/run')
      .set('Authorization', auth)
      .send({ symbol: 'AAPL', timeframe: 'invalid' });
    expect(res.status).toBe(400);
  });
});
