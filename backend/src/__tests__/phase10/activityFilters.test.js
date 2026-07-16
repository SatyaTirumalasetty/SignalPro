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
  mockDb.manyOrNone.mockResolvedValue([]);
  mockDb.one.mockResolvedValue({ count: '0' });
});

describe('GET /api/auto-trading/activity filters', () => {
  test('passes symbol and action into the WHERE clause and params', async () => {
    await request(app).get('/api/auto-trading/activity?symbol=NVDA&action=order_placed');
    const [listSql, listParams] = mockDb.manyOrNone.mock.calls[0];
    expect(listSql).toContain('symbol =');
    expect(listSql).toContain('action =');
    expect(listParams).toContain('NVDA');
    expect(listParams).toContain('order_placed');
  });

  test('passes from/to date bounds', async () => {
    await request(app).get('/api/auto-trading/activity?from=2026-07-01&to=2026-07-14');
    const [listSql, listParams] = mockDb.manyOrNone.mock.calls[0];
    expect(listSql).toContain('created_at >=');
    expect(listSql).toContain('created_at <=');
    expect(listParams).toContain('2026-07-01');
    expect(listParams).toContain('2026-07-14');
  });

  test('still works with no filters', async () => {
    const res = await request(app).get('/api/auto-trading/activity');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ runs: [], total: 0, limit: 50, offset: 0 });
  });
});
