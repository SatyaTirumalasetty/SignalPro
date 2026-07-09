const mockCacheGet = jest.fn();
const mockCacheSet = jest.fn();
jest.mock('../../config/redis', () => ({ cacheGet: mockCacheGet, cacheSet: mockCacheSet }));

const mockAxiosGet = jest.fn();
jest.mock('axios', () => ({ get: (...args) => mockAxiosGet(...args) }));

const { getHistoricalPage } = require('../../services/marketData');

function yahooPayload(n) {
  // n ascending 1-minute candles starting at t0
  const t0 = 1760000000; // seconds
  return {
    chart: {
      result: [{
        meta: { symbol: 'AAPL', currency: 'USD', exchangeName: 'NMS', instrumentType: 'EQUITY', regularMarketPrice: 100 + n, chartPreviousClose: 100 },
        timestamp: Array.from({ length: n }, (_, i) => t0 + i * 60),
        indicators: { quote: [{
          open: Array.from({ length: n }, (_, i) => 100 + i),
          high: Array.from({ length: n }, (_, i) => 101 + i),
          low: Array.from({ length: n }, (_, i) => 99 + i),
          close: Array.from({ length: n }, (_, i) => 100.5 + i),
          volume: Array.from({ length: n }, () => 1000),
        }] },
      }],
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCacheGet.mockResolvedValue(null);
  mockCacheSet.mockResolvedValue(undefined);
  mockAxiosGet.mockResolvedValue({ data: yahooPayload(500) });
});

describe('getHistoricalPage', () => {
  test('no cursor returns the newest `bars` candles with has_more', async () => {
    const page = await getHistoricalPage('AAPL', '1m', 300);
    expect(page.candles).toHaveLength(300);
    expect(page.has_more).toBe(true);
    // ascending order, newest last
    expect(page.candles[299].timestamp).toBeGreaterThan(page.candles[0].timestamp);
  });

  test('before cursor returns strictly older candles', async () => {
    const first = await getHistoricalPage('AAPL', '1m', 300);
    const cursor = first.candles[0].timestamp;
    const older = await getHistoricalPage('AAPL', '1m', 300, cursor);
    expect(older.candles.length).toBe(200); // 500 total - 300 newer
    expect(older.candles.every((c) => c.timestamp < cursor)).toBe(true);
    expect(older.has_more).toBe(false);
  });

  test('full-range fetch is cached: two pages, one upstream call', async () => {
    mockCacheGet.mockResolvedValueOnce(null); // first call: miss
    const first = await getHistoricalPage('AAPL', '1m', 300);
    // second call: serve the full range from cache
    const [, fullRange] = mockCacheSet.mock.calls.find(([key]) => key.startsWith('histfull:'));
    mockCacheGet.mockResolvedValueOnce(fullRange);
    await getHistoricalPage('AAPL', '1m', 300, first.candles[0].timestamp);
    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
  });
});
