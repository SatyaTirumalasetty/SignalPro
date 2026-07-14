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
  mockDb.one.mockResolvedValue({ preferences: {} });
});

describe('GET /api/auto-trading/symbol-performance', () => {
  test('merges run stats with position P&L per symbol', async () => {
    mockDb.manyOrNone.mockImplementation((sql) => {
      if (sql.includes('FROM auto_trading_runs')) return Promise.resolve([
        { symbol: 'NVDA', trades: 7, avg_confidence: '68', last_action: 'order_placed', last_action_at: '2026-07-14T12:00:00.000Z' },
        { symbol: 'AAPL', trades: 4, avg_confidence: '59', last_action: 'skipped_low_confidence', last_action_at: '2026-07-14T12:05:00.000Z' },
      ]);
      if (sql.includes('FROM positions')) return Promise.resolve([
        { symbol: 'NVDA', realized_pnl: '412.00', unrealized_pnl: '120.00', wins: '5', closed: '7' },
        { symbol: 'AAPL', realized_pnl: '-83.00', unrealized_pnl: '0.00', wins: '2', closed: '4' },
      ]);
      return Promise.resolve([]);
    });

    const res = await request(app).get('/api/auto-trading/symbol-performance');
    expect(res.status).toBe(200);
    expect(res.body.symbols[0]).toEqual({
      symbol: 'NVDA', trades: 7, win_rate: 5 / 7, realized_pnl: 412, unrealized_pnl: 120,
      avg_confidence: 68, last_action: 'order_placed', last_action_at: '2026-07-14T12:00:00.000Z',
    });
    expect(res.body.symbols[1].symbol).toBe('AAPL');
    expect(res.body.symbols[1].realized_pnl).toBe(-83);
  });

  test('win_rate is null for a symbol with no closed positions', async () => {
    mockDb.manyOrNone.mockImplementation((sql) => {
      if (sql.includes('FROM auto_trading_runs')) return Promise.resolve([
        { symbol: 'TSLA', trades: 0, avg_confidence: null, last_action: 'hold', last_action_at: '2026-07-14T12:00:00.000Z' },
      ]);
      return Promise.resolve([]);
    });
    const res = await request(app).get('/api/auto-trading/symbol-performance');
    expect(res.body.symbols[0].win_rate).toBeNull();
    expect(res.body.symbols[0].realized_pnl).toBe(0);
    expect(res.body.symbols[0].avg_confidence).toBeNull();
  });
});
