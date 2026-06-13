jest.mock('axios');
jest.mock('../../config/redis', () => ({
  cacheGet: jest.fn().mockResolvedValue(null),
  cacheSet: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
}));

const axios = require('axios');
const { cacheGet, cacheSet } = require('../../config/redis');

const ORIGINAL_ENV = { ...process.env };

function loadModule() {
  jest.resetModules();
  jest.doMock('axios', () => axios);
  jest.doMock('../../config/redis', () => ({ cacheGet, cacheSet }));
  jest.doMock('../../config/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));
  return require('../../services/alpacaMarketData');
}

beforeEach(() => {
  jest.clearAllMocks();
  cacheGet.mockResolvedValue(null);
  cacheSet.mockResolvedValue(undefined);
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('isConfigured()', () => {
  test('returns false when API key/secret are missing', () => {
    delete process.env.ALPACA_API_KEY;
    delete process.env.ALPACA_API_SECRET;
    const { isConfigured } = loadModule();
    expect(isConfigured()).toBe(false);
  });

  test('returns true when API key and secret are set', () => {
    process.env.ALPACA_API_KEY = 'key';
    process.env.ALPACA_API_SECRET = 'secret';
    const { isConfigured } = loadModule();
    expect(isConfigured()).toBe(true);
  });
});

describe('getLatestQuotes()', () => {
  test('returns empty object when not configured', async () => {
    delete process.env.ALPACA_API_KEY;
    delete process.env.ALPACA_API_SECRET;
    const { getLatestQuotes } = loadModule();
    const result = await getLatestQuotes(['AAPL']);
    expect(result).toEqual({});
    expect(axios.create).not.toHaveBeenCalled();
  });

  test('returns empty object when symbols list is empty', async () => {
    process.env.ALPACA_API_KEY = 'key';
    process.env.ALPACA_API_SECRET = 'secret';
    const { getLatestQuotes } = loadModule();
    const result = await getLatestQuotes([]);
    expect(result).toEqual({});
  });

  test('merges quote and trade data per symbol', async () => {
    process.env.ALPACA_API_KEY = 'key';
    process.env.ALPACA_API_SECRET = 'secret';

    const mockClient = {
      get: jest.fn((path) => {
        if (path === '/v2/stocks/quotes/latest') {
          return Promise.resolve({ data: { quotes: { AAPL: { bp: 149.5, ap: 150.5, bs: 10, as: 5, t: '2024-01-01T00:00:00Z' } } } });
        }
        return Promise.resolve({ data: { trades: { AAPL: { p: 150.0, s: 100, t: '2024-01-01T00:00:01Z' } } } });
      }),
    };
    axios.create.mockReturnValue(mockClient);

    const { getLatestQuotes } = loadModule();
    const result = await getLatestQuotes(['AAPL']);

    expect(result.AAPL).toEqual({
      price: 150.0,
      bid: 149.5,
      ask: 150.5,
      bid_size: 10,
      ask_size: 5,
      last_trade_size: 100,
      timestamp: '2024-01-01T00:00:01Z',
    });
  });

  test('falls back to mid-price when no trade is available', async () => {
    process.env.ALPACA_API_KEY = 'key';
    process.env.ALPACA_API_SECRET = 'secret';

    const mockClient = {
      get: jest.fn((path) => {
        if (path === '/v2/stocks/quotes/latest') {
          return Promise.resolve({ data: { quotes: { AAPL: { bp: 100, ap: 102, t: '2024-01-01T00:00:00Z' } } } });
        }
        return Promise.resolve({ data: { trades: {} } });
      }),
    };
    axios.create.mockReturnValue(mockClient);

    const { getLatestQuotes } = loadModule();
    const result = await getLatestQuotes(['AAPL']);
    expect(result.AAPL.price).toBe(101);
  });

  test('skips symbols with neither quote nor trade data', async () => {
    process.env.ALPACA_API_KEY = 'key';
    process.env.ALPACA_API_SECRET = 'secret';

    const mockClient = {
      get: jest.fn(() => Promise.resolve({ data: {} })),
    };
    axios.create.mockReturnValue(mockClient);

    const { getLatestQuotes } = loadModule();
    const result = await getLatestQuotes(['AAPL']);
    expect(result).toEqual({});
  });

  test('returns empty object on request failure', async () => {
    process.env.ALPACA_API_KEY = 'key';
    process.env.ALPACA_API_SECRET = 'secret';

    const mockClient = {
      get: jest.fn(() => Promise.reject(new Error('network error'))),
    };
    axios.create.mockReturnValue(mockClient);

    const { getLatestQuotes } = loadModule();
    const result = await getLatestQuotes(['AAPL']);
    expect(result).toEqual({});
  });
});

describe('getNews()', () => {
  test('returns empty array when not configured', async () => {
    delete process.env.ALPACA_API_KEY;
    delete process.env.ALPACA_API_SECRET;
    const { getNews } = loadModule();
    const result = await getNews(['AAPL']);
    expect(result).toEqual([]);
  });

  test('returns empty array when symbols list is empty', async () => {
    process.env.ALPACA_API_KEY = 'key';
    process.env.ALPACA_API_SECRET = 'secret';
    const { getNews } = loadModule();
    const result = await getNews([]);
    expect(result).toEqual([]);
  });

  test('returns cached news when available', async () => {
    process.env.ALPACA_API_KEY = 'key';
    process.env.ALPACA_API_SECRET = 'secret';
    const cached = [{ id: 1, headline: 'Cached headline' }];
    cacheGet.mockResolvedValueOnce(cached);

    const mockClient = { get: jest.fn() };
    axios.create.mockReturnValue(mockClient);

    const { getNews } = loadModule();
    const result = await getNews(['AAPL'], 5);
    expect(result).toEqual(cached);
    expect(mockClient.get).not.toHaveBeenCalled();
  });

  test('fetches and caches news on success', async () => {
    process.env.ALPACA_API_KEY = 'key';
    process.env.ALPACA_API_SECRET = 'secret';

    const mockClient = {
      get: jest.fn().mockResolvedValue({
        data: {
          news: [
            { id: 1, headline: 'Apple hits new high', summary: 'Summary', source: 'Benzinga', url: 'https://example.com', symbols: ['AAPL'], created_at: '2024-01-01T00:00:00Z' },
          ],
        },
      }),
    };
    axios.create.mockReturnValue(mockClient);

    const { getNews } = loadModule();
    const result = await getNews(['AAPL'], 5);

    expect(result).toEqual([
      { id: 1, headline: 'Apple hits new high', summary: 'Summary', source: 'Benzinga', url: 'https://example.com', symbols: ['AAPL'], created_at: '2024-01-01T00:00:00Z' },
    ]);
    expect(cacheSet).toHaveBeenCalledWith('alpaca:news:AAPL:5', result, 600);
  });

  test('returns empty array on request failure', async () => {
    process.env.ALPACA_API_KEY = 'key';
    process.env.ALPACA_API_SECRET = 'secret';

    const mockClient = { get: jest.fn().mockRejectedValue(new Error('network error')) };
    axios.create.mockReturnValue(mockClient);

    const { getNews } = loadModule();
    const result = await getNews(['AAPL'], 5);
    expect(result).toEqual([]);
  });
});
