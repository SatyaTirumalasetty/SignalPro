const request = require('supertest');
const express = require('express');

const mockDb = { one: jest.fn(), oneOrNone: jest.fn(), manyOrNone: jest.fn(), none: jest.fn() };
jest.mock('../../config/database', () => ({ db: mockDb }));
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'user-1' }; next(); },
}));

const autoTradingRouter = require('../../routes/autoTrading');
const app = express();
app.use(express.json());
app.use('/api/auto-trading', autoTradingRouter);

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.one.mockResolvedValue({});
  mockDb.oneOrNone.mockResolvedValue(null);
  mockDb.manyOrNone.mockResolvedValue([]);
});

describe('GET /api/auto-trading/metrics', () => {
  test('assembles health, performance, decision breakdown and avg confidence', async () => {
    // Order matters: the positions win-rate query also contains "action =
    // 'order_placed'" in its attribution subquery, so match it (AS wins) first.
    mockDb.one.mockImplementation((sql) => {
      if (sql.includes('FROM users')) return Promise.resolve({ preferences: { auto_trading: { enabled: true } } });
      if (sql.includes('AS wins')) return Promise.resolve({ wins: '11', total: '18' });
      if (sql.includes('CURRENT_DATE')) return Promise.resolve({ count: '2' });
      if (sql.includes("IN ('error'")) return Promise.resolve({ count: '0' });
      if (sql.includes('AVG(confidence)')) return Promise.resolve({ avg: '64.5' });
      if (sql.includes("action = 'order_placed'")) return Promise.resolve({ count: '18' });
      return Promise.resolve({});
    });
    mockDb.oneOrNone.mockResolvedValue({ created_at: '2026-07-14T12:00:00.000Z' });
    mockDb.manyOrNone.mockImplementation((sql) => {
      if (sql.includes('GROUP BY action')) return Promise.resolve([{ action: 'order_placed', count: 12 }]);
      if (sql.includes('FROM benchmark_snapshots')) return Promise.resolve([
        { engine_equity: '100000.00', watchlist_value: '100000.00' },
        { engine_equity: '104200.00', watchlist_value: '103100.00' },
      ]);
      return Promise.resolve([]);
    });

    const res = await request(app).get('/api/auto-trading/metrics');
    expect(res.status).toBe(200);
    expect(res.body.health).toEqual({
      enabled: true, last_run_at: '2026-07-14T12:00:00.000Z', errors_24h: 0, circuit_breaker_threshold: 5, trades_today: 2,
    });
    expect(res.body.performance.return_pct).toBeCloseTo(4.2, 3);
    expect(res.body.performance.vs_buy_hold_pct).toBeCloseTo(1.1, 3);
    expect(res.body.performance.win_rate).toBeCloseTo(11 / 18, 4);
    expect(res.body.performance.trades).toBe(18);
    expect(res.body.decision_breakdown).toEqual([{ action: 'order_placed', count: 12 }]);
    expect(res.body.avg_confidence).toBe(64.5);
  });

  test('returns null performance ratios when fewer than two snapshots', async () => {
    mockDb.one.mockImplementation((sql) => {
      if (sql.includes('FROM users')) return Promise.resolve({ preferences: {} });
      if (sql.includes('FROM positions')) return Promise.resolve({ wins: '0', total: '0' });
      if (sql.includes('AVG(confidence)')) return Promise.resolve({ avg: null });
      return Promise.resolve({ count: '0' });
    });
    mockDb.manyOrNone.mockResolvedValue([]);
    const res = await request(app).get('/api/auto-trading/metrics');
    expect(res.status).toBe(200);
    expect(res.body.performance.return_pct).toBeNull();
    expect(res.body.performance.vs_buy_hold_pct).toBeNull();
    expect(res.body.performance.win_rate).toBeNull();
    expect(res.body.avg_confidence).toBeNull();
  });
});
