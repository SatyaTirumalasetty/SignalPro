const request = require('supertest');
const express = require('express');
const { generateAccessToken } = require('../../middleware/auth');

const mockDb = {
  one: jest.fn(),
  oneOrNone: jest.fn(),
  manyOrNone: jest.fn(),
  none: jest.fn(),
};

jest.mock('../../config/database', () => ({ db: mockDb }));

const router = require('../../routes/autoTrading');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auto-trading', router);
  app.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}

const USER_ID = 'user-uuid-789';
const CONN_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const userToken = generateAccessToken({ id: USER_ID, email: 'trader@test.com', role: 'user' });
const auth = `Bearer ${userToken}`;

const app = createApp();

beforeEach(() => {
  jest.resetAllMocks();
});

describe('GET /api/auto-trading/settings', () => {
  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/auto-trading/settings');
    expect(res.status).toBe(401);
  });

  test('returns default settings when none configured', async () => {
    mockDb.one.mockResolvedValueOnce({ preferences: null });
    const res = await request(app).get('/api/auto-trading/settings').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.settings.enabled).toBe(false);
    expect(res.body.settings.symbols).toEqual([]);
  });

  test('returns stored settings merged with defaults', async () => {
    mockDb.one.mockResolvedValueOnce({ preferences: { auto_trading: { enabled: true, symbols: ['AAPL'] } } });
    const res = await request(app).get('/api/auto-trading/settings').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.settings.enabled).toBe(true);
    expect(res.body.settings.symbols).toEqual(['AAPL']);
    expect(res.body.settings.min_confidence).toBe(70);
  });
});

describe('PUT /api/auto-trading/settings', () => {
  test('returns 400 for invalid timeframe', async () => {
    const res = await request(app)
      .put('/api/auto-trading/settings')
      .set('Authorization', auth)
      .send({ timeframes: ['3m'] });
    expect(res.status).toBe(400);
  });

  test('returns 400 when enabling without a broker connection', async () => {
    mockDb.one.mockResolvedValueOnce({ preferences: {} });
    const res = await request(app)
      .put('/api/auto-trading/settings')
      .set('Authorization', auth)
      .send({ enabled: true, symbols: ['AAPL'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/broker_connection_id/i);
  });

  test('returns 400 when enabling with empty symbols', async () => {
    const res = await request(app)
      .put('/api/auto-trading/settings')
      .set('Authorization', auth)
      .send({ enabled: true, broker_connection_id: CONN_ID, symbols: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/symbol/i);
  });

  test('returns 404 for unknown broker connection', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    const res = await request(app)
      .put('/api/auto-trading/settings')
      .set('Authorization', auth)
      .send({ broker_connection_id: CONN_ID, symbols: ['AAPL'] });
    expect(res.status).toBe(404);
  });

  test('persists merged settings', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce({ id: CONN_ID });
    mockDb.one
      .mockResolvedValueOnce({ preferences: {} }) // current settings lookup
      .mockResolvedValueOnce({ preferences: { auto_trading: { enabled: true, broker_connection_id: CONN_ID, symbols: ['AAPL'], timeframes: ['1h'], min_confidence: 70, risk_per_trade_pct: 0.01, max_daily_loss_pct: 0.03, cooldown_minutes: 60, max_trades_per_day: 5 } } }); // update result

    const res = await request(app)
      .put('/api/auto-trading/settings')
      .set('Authorization', auth)
      .send({ enabled: true, broker_connection_id: CONN_ID, symbols: ['AAPL'] });

    expect(res.status).toBe(200);
    expect(res.body.settings.enabled).toBe(true);
    expect(res.body.settings.symbols).toEqual(['AAPL']);
    expect(mockDb.one).toHaveBeenLastCalledWith(
      expect.stringContaining('jsonb_set'),
      expect.arrayContaining([expect.any(String), USER_ID])
    );
  });
});

describe('GET /api/auto-trading/activity', () => {
  test('returns paginated activity feed', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce([{ id: 'run-1', symbol: 'AAPL', action: 'order_placed' }]);
    mockDb.one.mockResolvedValueOnce({ count: '1' });

    const res = await request(app).get('/api/auto-trading/activity').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });
});

describe('GET /api/auto-trading/status', () => {
  test('returns status summary', async () => {
    mockDb.one
      .mockResolvedValueOnce({ preferences: { auto_trading: { enabled: true } } })
      .mockResolvedValueOnce({ count: '2' })
      .mockResolvedValueOnce({ pnl: '125.50' });
    mockDb.oneOrNone.mockResolvedValueOnce({ created_at: '2026-06-14T10:00:00Z' });

    const res = await request(app).get('/api/auto-trading/status').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.trades_today).toBe(2);
    expect(res.body.todays_pnl).toBe(125.5);
    expect(res.body.last_run_at).toBe('2026-06-14T10:00:00Z');
  });
});
