// Set REDIS_URL so the module tries to connect
process.env.REDIS_URL = 'redis://localhost:6379';

const mockGet     = jest.fn();
const mockSet     = jest.fn();
const mockDel     = jest.fn();
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockOn      = jest.fn();

const mockClient = {
  get: mockGet, set: mockSet, del: mockDel,
  connect: mockConnect, on: mockOn,
  isReady: true,
};

jest.mock('redis', () => ({ createClient: jest.fn(() => mockClient) }));
jest.mock('../../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

// Load the module ONCE (after mocks are set up, before tests touch REDIS_URL)
const { cacheGet, cacheSet, cacheDel } = require('../../config/redis');

beforeEach(() => {
  jest.clearAllMocks();
  mockClient.isReady = true;
  mockOn.mockReturnValue(mockClient);
  mockConnect.mockResolvedValue(undefined);
});

describe('cacheGet()', () => {
  test('returns parsed JSON for existing key', async () => {
    mockGet.mockResolvedValueOnce(JSON.stringify({ price: 150 }));
    const result = await cacheGet('price:AAPL');
    expect(result).toEqual({ price: 150 });
  });

  test('returns null for missing key', async () => {
    mockGet.mockResolvedValueOnce(null);
    const result = await cacheGet('price:MISSING');
    expect(result).toBeNull();
  });

  test('returns null on get error (graceful degradation)', async () => {
    mockGet.mockRejectedValueOnce(new Error('Connection refused'));
    const result = await cacheGet('price:AAPL');
    expect(result).toBeNull();
  });

  test('returns null for malformed JSON', async () => {
    mockGet.mockResolvedValueOnce('{broken json{{');
    const result = await cacheGet('price:AAPL');
    expect(result).toBeNull();
  });

  test('returns string values parsed as JSON', async () => {
    mockGet.mockResolvedValueOnce(JSON.stringify('hello'));
    const result = await cacheGet('key');
    expect(result).toBe('hello');
  });
});

describe('cacheSet()', () => {
  test('stores JSON-serialized value with TTL', async () => {
    await cacheSet('price:AAPL', { price: 150 }, 60);
    expect(mockSet).toHaveBeenCalledWith(
      'price:AAPL',
      JSON.stringify({ price: 150 }),
      { EX: 60 },
    );
  });

  test('defaults TTL to 300 seconds', async () => {
    await cacheSet('key', 'value');
    expect(mockSet).toHaveBeenCalledWith('key', '"value"', { EX: 300 });
  });

  test('does not throw on set error', async () => {
    mockSet.mockRejectedValueOnce(new Error('write error'));
    await expect(cacheSet('key', 'value', 60)).resolves.not.toThrow();
  });
});

describe('cacheDel()', () => {
  test('deletes key from Redis', async () => {
    await cacheDel('price:AAPL');
    expect(mockDel).toHaveBeenCalledWith('price:AAPL');
  });

  test('does not throw on del error', async () => {
    mockDel.mockRejectedValueOnce(new Error('del error'));
    await expect(cacheDel('key')).resolves.not.toThrow();
  });
});

describe('graceful degradation (REDIS_URL absent)', () => {
  test('cacheGet returns null when no REDIS_URL', async () => {
    // Use isolateModules to test without REDIS_URL
    let isolatedCacheGet;
    const saved = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    await jest.isolateModulesAsync(async () => {
      jest.mock('../../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
      const m = require('../../config/redis');
      isolatedCacheGet = m.cacheGet;
    });
    const result = await isolatedCacheGet('any-key');
    expect(result).toBeNull();
    process.env.REDIS_URL = saved;
  });

  test('cacheSet is a no-op when no REDIS_URL', async () => {
    let isolatedCacheSet;
    const saved = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    await jest.isolateModulesAsync(async () => {
      jest.mock('../../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
      const m = require('../../config/redis');
      isolatedCacheSet = m.cacheSet;
    });
    await expect(isolatedCacheSet('key', 'value')).resolves.toBeUndefined();
    process.env.REDIS_URL = saved;
  });
});
