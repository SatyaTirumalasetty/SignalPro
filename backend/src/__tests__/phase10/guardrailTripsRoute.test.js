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

describe('GET /api/auto-trading/guardrail-trips', () => {
  test('returns skip-reason counts and sufficiency', async () => {
    mockDb.one.mockResolvedValue({ count: '140' });
    mockDb.manyOrNone.mockResolvedValue([
      { action: 'skipped_low_confidence', count: 24 },
      { action: 'skipped_existing_position', count: 13 },
    ]);
    const res = await request(app).get('/api/auto-trading/guardrail-trips');
    expect(res.status).toBe(200);
    expect(res.body.trips).toEqual([
      { action: 'skipped_low_confidence', count: 24 },
      { action: 'skipped_existing_position', count: 13 },
    ]);
    expect(res.body.total_runs).toBe(140);
    expect(res.body.min_required).toBe(20);
    expect(res.body.sufficient).toBe(true);
  });

  test('sufficient false below threshold', async () => {
    mockDb.one.mockResolvedValue({ count: '5' });
    mockDb.manyOrNone.mockResolvedValue([]);
    const res = await request(app).get('/api/auto-trading/guardrail-trips');
    expect(res.body.sufficient).toBe(false);
    expect(res.body.trips).toEqual([]);
  });
});
