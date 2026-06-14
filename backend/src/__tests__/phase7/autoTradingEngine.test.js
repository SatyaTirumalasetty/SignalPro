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
  analyzeAndTrade, runForUser, runAutoTradingCycle, getAutoTradingSettings, DEFAULT_SETTINGS,
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

describe('analyzeAndTrade', () => {
  test('skips when within cooldown', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce({ id: 'run-1' }); // cooldown row

    await analyzeAndTrade(USER_ID, SETTINGS, CONN, 'AAPL', '1h');

    expect(mockDb.none).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO auto_trading_runs'),
      expect.arrayContaining([USER_ID, 'AAPL', '1h', null, null, 'skipped_cooldown'])
    );
    expect(mockGenerateSignal).not.toHaveBeenCalled();
  });

  test('skips when daily trade limit reached', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null); // no cooldown
    mockDb.one.mockResolvedValueOnce({ count: '5' }); // trades today >= max

    await analyzeAndTrade(USER_ID, SETTINGS, CONN, 'AAPL', '1h');

    expect(mockDb.none).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO auto_trading_runs'),
      expect.arrayContaining(['skipped_daily_trade_limit'])
    );
    expect(mockGenerateSignal).not.toHaveBeenCalled();
  });

  test('logs error when no market data available', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    mockDb.one.mockResolvedValueOnce({ count: '0' });
    mockGetHistoricalData.mockResolvedValueOnce({ candles: [] });

    await analyzeAndTrade(USER_ID, SETTINGS, CONN, 'AAPL', '1h');

    expect(mockDb.none).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO auto_trading_runs'),
      expect.arrayContaining(['error'])
    );
    expect(mockGenerateSignal).not.toHaveBeenCalled();
  });

  test('skips on hold signal', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    mockDb.one.mockResolvedValueOnce({ count: '0' });
    mockGenerateSignal.mockResolvedValueOnce({ id: 'sig-1', signal: 'hold', confidence: 40, reasoning: 'no edge' });

    await analyzeAndTrade(USER_ID, SETTINGS, CONN, 'AAPL', '1h');

    expect(mockDb.none).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO auto_trading_runs'),
      expect.arrayContaining(['hold', 40, 'skipped_low_confidence', 'sig-1'])
    );
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  test('skips on low confidence buy signal', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    mockDb.one.mockResolvedValueOnce({ count: '0' });
    mockGenerateSignal.mockResolvedValueOnce({ id: 'sig-1', signal: 'buy', confidence: 60, reasoning: 'weak' });

    await analyzeAndTrade(USER_ID, SETTINGS, CONN, 'AAPL', '1h');

    expect(mockDb.none).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO auto_trading_runs'),
      expect.arrayContaining(['skipped_low_confidence'])
    );
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  test('skips when an existing position in the same direction is open', async () => {
    mockDb.oneOrNone
      .mockResolvedValueOnce(null) // cooldown
      .mockResolvedValueOnce({ id: 'pos-1' }); // existing position
    mockDb.one.mockResolvedValueOnce({ count: '0' });
    mockGenerateSignal.mockResolvedValueOnce({ id: 'sig-1', signal: 'buy', confidence: 90, reasoning: 'strong', entry_price: 150, stop_loss: 140, take_profit: 170 });

    await analyzeAndTrade(USER_ID, SETTINGS, CONN, 'AAPL', '1h');

    expect(mockDb.none).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO auto_trading_runs'),
      expect.arrayContaining(['skipped_existing_position'])
    );
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  test('skips when daily loss limit exceeded', async () => {
    mockDb.oneOrNone
      .mockResolvedValueOnce(null) // cooldown
      .mockResolvedValueOnce(null); // no existing position
    mockDb.one
      .mockResolvedValueOnce({ count: '0' }) // trades today
      .mockRejectedValueOnce(Object.assign(new Error('Daily loss limit reached'), { code: 'RISK_LIMIT_EXCEEDED' }));
    mockGenerateSignal.mockResolvedValueOnce({ id: 'sig-1', signal: 'buy', confidence: 90, reasoning: 'strong', entry_price: 150, stop_loss: 140, take_profit: 170 });

    await analyzeAndTrade(USER_ID, SETTINGS, CONN, 'AAPL', '1h');

    expect(mockDb.none).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO auto_trading_runs'),
      expect.arrayContaining(['skipped_daily_loss_limit'])
    );
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  test('skips when computed position size is zero', async () => {
    mockDb.oneOrNone
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockDb.one
      .mockResolvedValueOnce({ count: '0' })
      .mockResolvedValueOnce({ realized_pnl: '0' });
    // entry_price == stop_loss -> perUnitRisk 0 -> sized qty 0
    mockGenerateSignal.mockResolvedValueOnce({ id: 'sig-1', signal: 'buy', confidence: 90, reasoning: 'strong', entry_price: 150, stop_loss: 150, take_profit: 170 });

    await analyzeAndTrade(USER_ID, SETTINGS, CONN, 'AAPL', '1h');

    expect(mockDb.none).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO auto_trading_runs'),
      expect.arrayContaining(['skipped_risk_sizing'])
    );
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  test('places an order and logs order_placed on a confident buy signal', async () => {
    mockDb.oneOrNone
      .mockResolvedValueOnce(null) // cooldown
      .mockResolvedValueOnce(null); // no existing position
    mockDb.one
      .mockResolvedValueOnce({ count: '0' }) // trades today
      .mockResolvedValueOnce({ realized_pnl: '0' }); // daily loss check
    mockGenerateSignal.mockResolvedValueOnce({
      id: 'sig-1', signal: 'buy', confidence: 90, reasoning: 'strong setup',
      entry_price: 150, stop_loss: 140, take_profit: 170,
    });
    mockPlaceOrder.mockResolvedValueOnce({ id: 'order-1', status: 'pending' });

    await analyzeAndTrade(USER_ID, SETTINGS, CONN, 'AAPL', '1h');

    expect(mockPlaceOrder).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER_ID, brokerConnectionId: CONN.id, symbol: 'AAPL', side: 'buy',
      quantity: 100, // (100000 * 0.01) / |150-140|
      signalId: 'sig-1', source: 'auto_engine',
    }));
    expect(mockDb.none).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO auto_trading_runs'),
      expect.arrayContaining(['order_placed', 'sig-1', 'order-1'])
    );
  });

  test('emails the user when an order is placed and an email is provided', async () => {
    mockDb.oneOrNone
      .mockResolvedValueOnce(null) // cooldown
      .mockResolvedValueOnce(null); // no existing position
    mockDb.one
      .mockResolvedValueOnce({ count: '0' }) // trades today
      .mockResolvedValueOnce({ realized_pnl: '0' }); // daily loss check
    mockGenerateSignal.mockResolvedValueOnce({
      id: 'sig-1', signal: 'buy', confidence: 90, reasoning: 'strong setup',
      entry_price: 150, stop_loss: 140, take_profit: 170,
    });
    mockPlaceOrder.mockResolvedValueOnce({ id: 'order-1', status: 'pending' });

    await analyzeAndTrade(USER_ID, SETTINGS, CONN, 'AAPL', '1h', 'user@example.com');

    expect(mockSendAutoTradingOrderEmail).toHaveBeenCalledWith('user@example.com', expect.objectContaining({
      symbol: 'AAPL', side: 'buy', quantity: 100, price: 150,
    }));
  });

  test('emails the user once per day when the daily loss limit is hit', async () => {
    mockDb.oneOrNone
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockDb.one
      .mockResolvedValueOnce({ count: '0' })
      .mockRejectedValueOnce(Object.assign(new Error('Daily loss limit reached'), { code: 'RISK_LIMIT_EXCEEDED' }));
    mockGenerateSignal.mockResolvedValueOnce({ id: 'sig-1', signal: 'buy', confidence: 90, reasoning: 'strong', entry_price: 150, stop_loss: 140, take_profit: 170 });

    await analyzeAndTrade(USER_ID, SETTINGS, CONN, 'AAPL', '1h', 'user@example.com');

    expect(mockSendAutoTradingDailyLossLimitEmail).toHaveBeenCalledWith('user@example.com');
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
