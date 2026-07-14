const request = require('supertest');
const express = require('express');

jest.mock('../../services/marketData', () => ({
  getCurrentPrice: jest.fn(),
  getLiveQuote: jest.fn(),
  getHistoricalData: jest.fn(),
  getHistoricalPage: jest.fn(),
  searchSymbols: jest.fn(),
}));
jest.mock('../../services/indicators', () => ({ calculateAll: jest.fn() }));
jest.mock('../../middleware/auth', () => ({ optionalAuth: (_req, _res, next) => next() }));

const { getCurrentPrice } = require('../../services/marketData');
const marketRouter = require('../../routes/market');
const app = express();
app.use(express.json());
app.use('/api/market', marketRouter);

beforeEach(() => { jest.clearAllMocks(); });

describe('GET /api/market/prices', () => {
  test('returns price + numeric change_percent per resolvable symbol', async () => {
    getCurrentPrice.mockImplementation((sym) => {
      if (sym === 'AAPL') return Promise.resolve({ symbol: 'AAPL', price: 205.05, change_percent: '1.20' });
      if (sym === 'MSFT') return Promise.resolve({ symbol: 'MSFT', price: 410.1, change_percent: '-0.30' });
      return Promise.reject(new Error('not found'));
    });
    const res = await request(app).get('/api/market/prices?symbols=AAPL,MSFT');
    expect(res.status).toBe(200);
    expect(res.body.prices).toEqual([
      { symbol: 'AAPL', price: 205.05, change_percent: 1.2 },
      { symbol: 'MSFT', price: 410.1, change_percent: -0.3 },
    ]);
  });

  test('omits a symbol whose price lookup fails but still returns the others', async () => {
    getCurrentPrice.mockImplementation((sym) =>
      sym === 'AAPL'
        ? Promise.resolve({ symbol: 'AAPL', price: 205.05, change_percent: '1.20' })
        : Promise.reject(new Error('boom')));
    const res = await request(app).get('/api/market/prices?symbols=AAPL,BADSYM');
    expect(res.status).toBe(200);
    expect(res.body.prices).toEqual([{ symbol: 'AAPL', price: 205.05, change_percent: 1.2 }]);
  });

  test('400 when symbols is missing', async () => {
    const res = await request(app).get('/api/market/prices');
    expect(res.status).toBe(400);
  });
});
