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

beforeEach(() => { jest.clearAllMocks(); mockDb.one.mockResolvedValue({ preferences: {} }); });

describe('GET /api/auto-trading/calibration', () => {
  test('buckets closed positions by entry confidence and computes win rate', async () => {
    mockDb.manyOrNone.mockResolvedValue([
      { pnl: '100', entry_confidence: '72' },
      { pnl: '50', entry_confidence: '75' },
      { pnl: '-20', entry_confidence: '78' },
      { pnl: '200', entry_confidence: '92' },
      { pnl: '10', entry_confidence: null },
    ]);
    const res = await request(app).get('/api/auto-trading/calibration');
    expect(res.status).toBe(200);
    const bucket70 = res.body.buckets.find((b) => b.range === '70-80');
    expect(bucket70).toEqual({ range: '70-80', trades: 3, win_rate: 2 / 3 });
    const bucket90 = res.body.buckets.find((b) => b.range === '90-100');
    expect(bucket90).toEqual({ range: '90-100', trades: 1, win_rate: 1 });
    expect(res.body.total_closed).toBe(4); // null entry_confidence excluded
    expect(res.body.min_required).toBe(10);
    expect(res.body.sufficient).toBe(false);
  });

  test('empty data returns no buckets and sufficient false', async () => {
    mockDb.manyOrNone.mockResolvedValue([]);
    const res = await request(app).get('/api/auto-trading/calibration');
    expect(res.body).toEqual({ buckets: [], total_closed: 0, min_required: 10, sufficient: false });
  });
});
