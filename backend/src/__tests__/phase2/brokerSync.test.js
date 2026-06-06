process.env.ENCRYPTION_KEY = 'test_key_32_bytes_padding_here!!';

const mockDb = {
  one: jest.fn(),
  oneOrNone: jest.fn(),
  none: jest.fn().mockResolvedValue(undefined),
  manyOrNone: jest.fn(),
  result: jest.fn(),
};

jest.mock('../../config/database', () => ({ db: mockDb, initializeDatabase: jest.fn() }));
jest.mock('../../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('node-cron', () => ({
  schedule: jest.fn((expr, fn) => ({ start: jest.fn(), stop: jest.fn() })),
}));
jest.mock('axios', () => {
  const mockInstance = { get: jest.fn(), post: jest.fn(), interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } } };
  const axios = jest.fn(() => mockInstance);
  axios.create = jest.fn(() => mockInstance);
  axios._mockInstance = mockInstance;
  return axios;
});

const { encryptCredentials } = require('../../config/brokerEncryption');

const alpacaCreds = encryptCredentials({ api_key: 'APCA_KEY', api_secret: 'APCA_SECRET', paper_trading: false });
const activeConnection = {
  id: 'conn-1', user_id: 'user-1', broker_id: 'alpaca',
  credentials_encrypted: alpacaCreds, status: 'connected', token_expires_at: null,
};

beforeEach(() => jest.clearAllMocks());

// ── syncConnection ────────────────────────────────────────────────────────────

describe('syncConnection', () => {
  test('calls getAccountInfo and updates DB on success', async () => {
    const axios = require('axios');
    axios._mockInstance.get.mockResolvedValueOnce({
      data: { id: 'acc-1', equity: '50000', cash: '10000', buying_power: '100000', status: 'ACTIVE', currency: 'USD' },
    });
    mockDb.oneOrNone.mockResolvedValueOnce(activeConnection);

    const { syncConnection } = require('../../services/brokerSync');
    await syncConnection('conn-1');
    // Verify DB update was called (none called for UPDATE and logSync INSERT)
    expect(mockDb.none).toHaveBeenCalled();
  });

  test('sets status to error and logs when adapter throws', async () => {
    const axios = require('axios');
    const err = new Error('API error');
    err.response = { status: 401 };
    axios._mockInstance.get.mockRejectedValueOnce(err);
    mockDb.oneOrNone.mockResolvedValueOnce(activeConnection);

    const { syncConnection } = require('../../services/brokerSync');
    // syncConnection catches errors internally, should not throw
    await expect(syncConnection('conn-1')).resolves.toBeUndefined();
    expect(mockDb.none).toHaveBeenCalled(); // error UPDATE was called
  });

  test('returns undefined (no-op) when connection not found', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    const { syncConnection } = require('../../services/brokerSync');
    // Returns undefined quietly when connection is null
    await expect(syncConnection('nonexistent')).resolves.toBeUndefined();
  });
});

// ── syncAllConnections ────────────────────────────────────────────────────────

describe('syncAllConnections', () => {
  test('syncs all active connections', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce([{ id: 'conn-1' }]);
    mockDb.oneOrNone.mockResolvedValue(activeConnection);
    const axios = require('axios');
    axios._mockInstance.get.mockResolvedValue({
      data: { id: 'acc-1', equity: '10000', cash: '5000', buying_power: '20000', status: 'ACTIVE', currency: 'USD' },
    });

    const { syncAllConnections } = require('../../services/brokerSync');
    await expect(syncAllConnections()).resolves.toBeUndefined();
  });

  test('handles empty connections gracefully', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce([]);
    const { syncAllConnections } = require('../../services/brokerSync');
    await expect(syncAllConnections()).resolves.not.toThrow();
  });
});

// ── startCronJobs ─────────────────────────────────────────────────────────────

describe('startCronJobs', () => {
  test('registers two cron schedules', () => {
    const cron = require('node-cron');
    const { startCronJobs } = require('../../services/brokerSync');
    startCronJobs();
    expect(cron.schedule).toHaveBeenCalledTimes(2);
  });

  test('uses correct cron expressions (15-min sync and daily midnight)', () => {
    const cron = require('node-cron');
    const { startCronJobs } = require('../../services/brokerSync');
    cron.schedule.mockClear();
    startCronJobs();
    const expressions = cron.schedule.mock.calls.map(c => c[0]);
    expect(expressions).toContain('*/15 * * * *');
    expect(expressions).toContain('0 0 * * *');
  });
});
