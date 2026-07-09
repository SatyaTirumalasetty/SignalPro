const mockDb = { one: jest.fn(), oneOrNone: jest.fn(), manyOrNone: jest.fn(), none: jest.fn() };
const mockDecryptCredentials = jest.fn();
const mockGetAdapter = jest.fn();
const mockGetCurrentPrice = jest.fn();

jest.mock('../../config/database', () => ({ db: mockDb }));
jest.mock('../../config/brokerEncryption', () => ({ decryptCredentials: mockDecryptCredentials }));
jest.mock('../../services/brokers/index', () => ({ getAdapter: mockGetAdapter }));
jest.mock('../../services/marketData', () => ({ getCurrentPrice: mockGetCurrentPrice }));

const { snapshotUser } = require('../../services/benchmarkService');

const USER = {
  id: 'user-1',
  email: 'u@x.com',
  preferences: { auto_trading: { enabled: true, broker_connection_id: 'conn-1', symbols: ['AAPL', 'MSFT'] } },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.oneOrNone.mockImplementation((sql) => {
    if (/broker_connections/.test(sql)) {
      return Promise.resolve({ id: 'conn-1', broker_id: 'alpaca', credentials_encrypted: 'enc' });
    }
    return Promise.resolve(null); // no prior snapshot
  });
  mockDb.none.mockResolvedValue(undefined);
  mockDecryptCredentials.mockReturnValue({ api_key: 'k' });
  mockGetAdapter.mockReturnValue({
    getAccountInfo: jest.fn().mockResolvedValue({ funds: { equity: 100000 } }),
  });
  mockGetCurrentPrice.mockImplementation((symbol) =>
    Promise.resolve({ price: symbol === 'AAPL' ? 200 : 400 })
  );
});

describe('snapshotUser', () => {
  test('first snapshot freezes an equal-weight composition and inserts', async () => {
    await snapshotUser(USER);
    const insert = mockDb.none.mock.calls.find(([sql]) => /INSERT INTO benchmark_snapshots/.test(sql));
    expect(insert).toBeTruthy();
    const [, params] = insert;
    // equity 100000 → 50000 per symbol → 250 AAPL @200, 125 MSFT @400
    const composition = JSON.parse(params[3]);
    expect(composition).toEqual({ AAPL: 250, MSFT: 125 });
    expect(params[1]).toBe(100000);           // engine_equity
    expect(params[2]).toBeCloseTo(100000, 0); // watchlist_value on day one ≈ equity
  });

  test('later snapshots reuse the frozen composition', async () => {
    mockDb.oneOrNone.mockImplementation((sql) => {
      if (/broker_connections/.test(sql)) {
        return Promise.resolve({ id: 'conn-1', broker_id: 'alpaca', credentials_encrypted: 'enc' });
      }
      return Promise.resolve({ watchlist_composition: { AAPL: 250, MSFT: 125 } });
    });
    mockGetCurrentPrice.mockImplementation((symbol) =>
      Promise.resolve({ price: symbol === 'AAPL' ? 210 : 390 })
    );
    await snapshotUser(USER);
    const [, params] = mockDb.none.mock.calls.find(([sql]) => /INSERT INTO benchmark_snapshots/.test(sql));
    // 250*210 + 125*390 = 52500 + 48750 = 101250
    expect(params[2]).toBeCloseTo(101250, 0);
    expect(JSON.parse(params[3])).toEqual({ AAPL: 250, MSFT: 125 });
  });

  test('skips users without auto-trading enabled', async () => {
    await snapshotUser({ id: 'u2', preferences: {} });
    expect(mockDb.none).not.toHaveBeenCalled();
  });
});
