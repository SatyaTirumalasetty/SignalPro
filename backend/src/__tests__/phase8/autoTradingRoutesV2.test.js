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
  mockDb.oneOrNone.mockResolvedValue(null);
  mockDb.manyOrNone.mockResolvedValue([]);
});

describe('PUT /api/auto-trading/settings (v2 fields)', () => {
  test('accepts a valid ai_mode and authority and deep-merges authority', async () => {
    mockDb.one
      .mockResolvedValueOnce({ preferences: { auto_trading: { authority: { close: true } } } }) // current read
      .mockResolvedValueOnce({ preferences: { auto_trading: { ai_mode: 'tiered', authority: { close: true, adjust_stop: true, partial_exit: false, add: false } } } }); // update returning
    const res = await request(app).put('/api/auto-trading/settings')
      .send({ ai_mode: 'tiered', authority: { adjust_stop: true } });
    expect(res.status).toBe(200);
    expect(res.body.settings.ai_mode).toBe('tiered');
    expect(res.body.settings.authority).toEqual({ close: true, adjust_stop: true, partial_exit: false, add: false });
  });

  test('rejects an unknown ai_mode', async () => {
    const res = await request(app).put('/api/auto-trading/settings').send({ ai_mode: 'turbo' });
    expect(res.status).toBe(400);
  });

  test('rejects non-boolean authority values', async () => {
    const res = await request(app).put('/api/auto-trading/settings').send({ authority: { close: 'yes' } });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/auto-trading/benchmark', () => {
  test('returns the two series', async () => {
    mockDb.manyOrNone.mockResolvedValue([
      { snapshot_date: '2026-07-08', engine_equity: '100100.00', watchlist_value: '100050.00' },
    ]);
    const res = await request(app).get('/api/auto-trading/benchmark');
    expect(res.status).toBe(200);
    expect(res.body.series).toEqual([
      { date: '2026-07-08', engine_equity: 100100, watchlist_value: 100050 },
    ]);
  });
});
