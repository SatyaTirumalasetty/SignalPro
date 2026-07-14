const request = require('supertest');
const express = require('express');

const mockDb = { one: jest.fn(), oneOrNone: jest.fn(), manyOrNone: jest.fn(), none: jest.fn() };
jest.mock('../../config/database', () => ({ db: mockDb }));
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'user-1' }; next(); },
}));

const watchlistRouter = require('../../routes/watchlist');
const app = express();
app.use(express.json());
app.use('/api/watchlist', watchlistRouter);

beforeEach(() => { jest.clearAllMocks(); });

describe('GET /api/watchlist', () => {
  test('seeds the curated 20 when preferences has no watchlist key', async () => {
    mockDb.one.mockResolvedValue({ preferences: {} });
    const res = await request(app).get('/api/watchlist');
    expect(res.status).toBe(200);
    expect(res.body.symbols).toHaveLength(20);
    expect(res.body.symbols).toContain('AAPL');
  });

  test('returns the stored list when present', async () => {
    mockDb.one.mockResolvedValue({ preferences: { watchlist: ['NVDA', 'TSLA'] } });
    const res = await request(app).get('/api/watchlist');
    expect(res.body.symbols).toEqual(['NVDA', 'TSLA']);
  });

  test('returns an empty list verbatim (does not re-seed)', async () => {
    mockDb.one.mockResolvedValue({ preferences: { watchlist: [] } });
    const res = await request(app).get('/api/watchlist');
    expect(res.body.symbols).toEqual([]);
  });
});

describe('PUT /api/watchlist', () => {
  test('normalizes (upper-case, trim, de-dupe) and writes only the watchlist key', async () => {
    mockDb.one.mockResolvedValue({ preferences: { watchlist: ['AAPL', 'MSFT'] } });
    const res = await request(app).put('/api/watchlist').send({ symbols: [' aapl ', 'MSFT', 'aapl'] });
    expect(res.status).toBe(200);
    const [sql, params] = mockDb.one.mock.calls[0];
    expect(sql).toContain("'{watchlist}'");
    expect(sql).toContain('jsonb_set');
    expect(JSON.parse(params[0])).toEqual(['AAPL', 'MSFT']); // trimmed, upper, de-duped
    expect(res.body.symbols).toEqual(['AAPL', 'MSFT']);
  });

  test('rejects an invalid ticker with 400', async () => {
    const res = await request(app).put('/api/watchlist').send({ symbols: ['AA PL'] });
    expect(res.status).toBe(400);
    expect(mockDb.one).not.toHaveBeenCalled();
  });

  test('rejects more than 100 symbols with 400', async () => {
    const many = Array.from({ length: 101 }, (_, i) => `SYM${i}`);
    const res = await request(app).put('/api/watchlist').send({ symbols: many });
    expect(res.status).toBe(400);
  });
});
