const mockDb = {
  one: jest.fn(),
  oneOrNone: jest.fn(),
  manyOrNone: jest.fn(),
  none: jest.fn(),
};
const mockDecryptCredentials = jest.fn();
const mockGetAdapter = jest.fn();
const mockGetHistoricalData = jest.fn();
const mockCalculateAll = jest.fn();
const mockGetNews = jest.fn();
const mockGenerateSignal = jest.fn();
const mockPlaceOrder = jest.fn();
const mockSendAutoTradingOrderEmail = jest.fn();
const mockSendAutoTradingDailyLossLimitEmail = jest.fn();
const mockSendAutoTradingDisabledEmail = jest.fn();

jest.mock('../../config/database', () => ({ db: mockDb }));
jest.mock('../../config/brokerEncryption', () => ({ decryptCredentials: mockDecryptCredentials }));
jest.mock('../../services/brokers/index', () => ({ getAdapter: mockGetAdapter }));
jest.mock('../../services/marketData', () => ({ getHistoricalData: mockGetHistoricalData }));
jest.mock('../../services/indicators', () => ({ calculateAll: mockCalculateAll }));
jest.mock('../../services/alpacaMarketData', () => ({ getNews: mockGetNews }));
jest.mock('../../services/aiAnalysis', () => ({ generateSignal: mockGenerateSignal }));
jest.mock('../../services/orderExecution', () => ({ placeOrder: mockPlaceOrder }));
jest.mock('../../services/emailService', () => ({
  sendAutoTradingOrderEmail: mockSendAutoTradingOrderEmail,
  sendAutoTradingDailyLossLimitEmail: mockSendAutoTradingDailyLossLimitEmail,
  sendAutoTradingDisabledEmail: mockSendAutoTradingDisabledEmail,
}));

const {
  runForUser, runAutoTradingCycle, getAutoTradingSettings, DEFAULT_SETTINGS,
  checkCircuitBreaker, CIRCUIT_BREAKER_ERROR_THRESHOLD,
} = require('../../services/autoTradingEngine');

const USER_ID = 'user-1';
const CONN = { id: 'conn-1', broker_id: 'alpaca', credentials_encrypted: 'enc:tag:data' };

const SETTINGS = {
  ...DEFAULT_SETTINGS,
  enabled: true,
  broker_connection_id: CONN.id,
  symbols: ['AAPL'],
  timeframes: ['1h'],
  min_confidence: 70,
};

const HIST_DATA = { current_price: 150, previous_close: 148, candles: [{ time: '2026-06-14T00:00', open: 1, high: 1, low: 1, close: 1, volume: 1 }] };

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.AUTO_TRADING_ENABLED;
  mockGetHistoricalData.mockResolvedValue(HIST_DATA);
  mockCalculateAll.mockReturnValue({ rsi_14: 50 });
  mockGetNews.mockResolvedValue([]);
  mockDecryptCredentials.mockReturnValue({ api_key: 'k', secret: 's' });
  mockGetAdapter.mockReturnValue({ getAccountInfo: jest.fn().mockResolvedValue({ funds: { equity: 100000 } }) });
  mockDb.none.mockResolvedValue(undefined);
  mockDb.manyOrNone.mockResolvedValue([]); // default: circuit breaker not tripped
  mockSendAutoTradingOrderEmail.mockResolvedValue(undefined);
  mockSendAutoTradingDailyLossLimitEmail.mockResolvedValue(undefined);
  mockSendAutoTradingDisabledEmail.mockResolvedValue(undefined);
});

describe('getAutoTradingSettings', () => {
  test('returns defaults when no preferences set', () => {
    expect(getAutoTradingSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  test('merges user overrides over defaults', () => {
    const result = getAutoTradingSettings({ auto_trading: { enabled: true, symbols: ['MSFT'] } });
    expect(result.enabled).toBe(true);
    expect(result.symbols).toEqual(['MSFT']);
    expect(result.min_confidence).toBe(DEFAULT_SETTINGS.min_confidence);
  });
});

describe('runForUser', () => {
  test('does nothing when no broker connection or symbols configured', async () => {
    await runForUser(USER_ID, { ...DEFAULT_SETTINGS, enabled: true });
    expect(mockDb.oneOrNone).not.toHaveBeenCalled();
  });

  test('does nothing when configured broker connection is not connected', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    await runForUser(USER_ID, SETTINGS);
    expect(mockGetHistoricalData).not.toHaveBeenCalled();
  });

  test('disables auto-trading and emails the user after consecutive errors trip the circuit breaker', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce(
      Array.from({ length: CIRCUIT_BREAKER_ERROR_THRESHOLD }, () => ({ action: 'error' }))
    );

    await runForUser(USER_ID, SETTINGS, 'user@example.com');

    expect(mockDb.none).toHaveBeenCalledWith(expect.stringContaining('UPDATE users'), expect.any(Array));
    expect(mockDb.none).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO auto_trading_runs'),
      expect.arrayContaining(['auto_disabled_errors'])
    );
    expect(mockSendAutoTradingDisabledEmail).toHaveBeenCalledWith('user@example.com');
    expect(mockDb.oneOrNone).not.toHaveBeenCalled(); // never reached broker connection lookup
  });

  test('logs but does not throw when the auto-disabled email fails to send', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce(
      Array.from({ length: CIRCUIT_BREAKER_ERROR_THRESHOLD }, () => ({ action: 'error' }))
    );
    mockSendAutoTradingDisabledEmail.mockRejectedValueOnce(new Error('smtp down'));

    await expect(runForUser(USER_ID, SETTINGS, 'user@example.com')).resolves.not.toThrow();

    expect(mockSendAutoTradingDisabledEmail).toHaveBeenCalledWith('user@example.com');
  });
});

describe('checkCircuitBreaker', () => {
  test('returns false when there are fewer than the threshold of recent runs', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce([{ action: 'error' }]);
    expect(await checkCircuitBreaker(USER_ID)).toBe(false);
  });

  test('returns false when the most recent runs are not all errors', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce([
      { action: 'error' },
      { action: 'order_placed' },
      ...Array.from({ length: CIRCUIT_BREAKER_ERROR_THRESHOLD - 2 }, () => ({ action: 'error' })),
    ]);
    expect(await checkCircuitBreaker(USER_ID)).toBe(false);
  });

  test('returns true when the last N runs all errored', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce(
      Array.from({ length: CIRCUIT_BREAKER_ERROR_THRESHOLD }, () => ({ action: 'error' }))
    );
    expect(await checkCircuitBreaker(USER_ID)).toBe(true);
  });
});

describe('runAutoTradingCycle', () => {
  test('skips entirely when AUTO_TRADING_ENABLED=false', async () => {
    process.env.AUTO_TRADING_ENABLED = 'false';
    await runAutoTradingCycle();
    expect(mockDb.manyOrNone).not.toHaveBeenCalled();
  });

  test('runs for each opted-in user', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce([{ id: USER_ID, preferences: { auto_trading: { ...SETTINGS } } }]);
    // runForUser -> conn lookup returns null (not connected) so it stops early
    mockDb.oneOrNone.mockResolvedValueOnce(null);

    await runAutoTradingCycle();

    expect(mockDb.manyOrNone).toHaveBeenCalledWith(expect.stringContaining("preferences->'auto_trading'->>'enabled'"));
  });
});
