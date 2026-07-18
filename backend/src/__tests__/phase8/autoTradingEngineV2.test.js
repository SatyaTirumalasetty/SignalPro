const mockDb = { one: jest.fn(), oneOrNone: jest.fn(), manyOrNone: jest.fn(), none: jest.fn() };
const mockDecryptCredentials = jest.fn();
const mockGetAdapter = jest.fn();
const mockBuildMarketContext = jest.fn();
const mockBuildScreeningSummaries = jest.fn();
const mockGenerateDecision = jest.fn();
const mockScreenSymbols = jest.fn();
const mockExecuteDecision = jest.fn();
const mockDailyLossEmail = jest.fn();
const mockDisabledEmail = jest.fn();

jest.mock('../../config/database', () => ({ db: mockDb }));
jest.mock('../../config/brokerEncryption', () => ({ decryptCredentials: mockDecryptCredentials }));
jest.mock('../../services/brokers/index', () => ({ getAdapter: mockGetAdapter }));
jest.mock('../../services/marketContext', () => ({
  buildMarketContext: mockBuildMarketContext,
  buildScreeningSummaries: mockBuildScreeningSummaries,
}));
jest.mock('../../services/aiAnalysis', () => ({
  generateDecision: mockGenerateDecision,
  screenSymbols: mockScreenSymbols,
}));
jest.mock('../../services/engineActions', () => ({ executeDecision: mockExecuteDecision }));
jest.mock('../../services/emailService', () => ({
  sendAutoTradingDailyLossLimitEmail: mockDailyLossEmail,
  sendAutoTradingDisabledEmail: mockDisabledEmail,
}));

const {
  runForUser, processSymbol, getAutoTradingSettings, DEFAULT_SETTINGS,
} = require('../../services/autoTradingEngine');

const USER_ID = 'user-1';
const EMAIL = 'u@x.com';
const CONN = { id: 'conn-1', broker_id: 'alpaca', credentials_encrypted: 'enc' };

const SETTINGS = {
  ...DEFAULT_SETTINGS,
  enabled: true,
  broker_connection_id: CONN.id,
  symbols: ['AAPL'],
  timeframes: ['1h', '4h'],
  min_confidence: 70,
};

function decision(overrides = {}) {
  return {
    action: 'open_long', confidence: 82, reasoning: 'r', timeframe_alignment: {},
    entry_price: 150, stop_loss: 145, take_profit: 160, exit_fraction: null,
    risk_reward: 2, invalidation: 'x', id: 'sig-1', ai_model: 'm', ai_tokens_used: 10,
    ...overrides,
  };
}

let adapter;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.AUTO_TRADING_ENABLED;
  adapter = {
    getAccountInfo: jest.fn().mockResolvedValue({ funds: { equity: 100000 } }),
    getPositions: jest.fn().mockResolvedValue([]),
  };
  mockDecryptCredentials.mockReturnValue({ api_key: 'k' });
  mockGetAdapter.mockReturnValue(adapter);
  mockDb.none.mockResolvedValue(undefined);
  mockDb.manyOrNone.mockResolvedValue([]); // circuit breaker clear
  // oneOrNone: broker connection row, cooldown row (null)
  mockDb.oneOrNone.mockImplementation((sql) => {
    if (/broker_connections/.test(sql)) return Promise.resolve(CONN);
    return Promise.resolve(null);
  });
  // one: trades-today count, realized pnl
  mockDb.one.mockImplementation((sql) => {
    if (/COUNT/.test(sql)) return Promise.resolve({ count: '0' });
    return Promise.resolve({ realized_pnl: '0' });
  });
  mockBuildMarketContext.mockResolvedValue({ symbol: 'AAPL', current_price: 150, timeframes: { '1h': {} }, news: [], position: null, portfolio: {} });
  mockGenerateDecision.mockResolvedValue(decision());
  mockExecuteDecision.mockResolvedValue({ action: 'order_placed', orderId: 'order-1' });
});

function lastRunLog() {
  const calls = mockDb.none.mock.calls.filter(([sql]) => /INSERT INTO auto_trading_runs/.test(sql));
  return calls[calls.length - 1]?.[1];
}

describe('settings', () => {
  test('defaults include ai_mode and authority', () => {
    expect(DEFAULT_SETTINGS.ai_mode).toBe('balanced');
    expect(DEFAULT_SETTINGS.authority).toEqual({ close: true, adjust_stop: false, partial_exit: false, add: false });
  });

  test('authority deep-merges over defaults', () => {
    const s = getAutoTradingSettings({ auto_trading: { authority: { adjust_stop: true } } });
    expect(s.authority).toEqual({ close: true, adjust_stop: true, partial_exit: false, add: false });
  });
});

describe('runForUser', () => {
  test('happy path: analyzes watchlist symbol and executes', async () => {
    await runForUser(USER_ID, SETTINGS, EMAIL);
    expect(mockGenerateDecision).toHaveBeenCalledTimes(1);
    expect(mockExecuteDecision).toHaveBeenCalledTimes(1);
    const log = lastRunLog();
    expect(log[5]).toBe('order_placed'); // action param position in logRun insert
  });

  test('universe includes open-position symbols not on the watchlist', async () => {
    adapter.getPositions.mockResolvedValue([{ symbol: 'TSLA', position_type: 'long', quantity: 5, average_price: 200, pnl: 10, market_value: 1000 }]);
    await runForUser(USER_ID, SETTINGS, EMAIL);
    const symbols = mockBuildMarketContext.mock.calls.map(([args]) => args.symbol);
    expect(symbols).toEqual(expect.arrayContaining(['AAPL', 'TSLA']));
  });

  test('daily loss limit blocks entries but position management continues', async () => {
    mockDb.one.mockImplementation((sql) => {
      if (/COUNT/.test(sql)) return Promise.resolve({ count: '0' });
      return Promise.resolve({ realized_pnl: '-5000' }); // -5000 >= 3% of 100000
    });
    adapter.getPositions.mockResolvedValue([{ symbol: 'TSLA', position_type: 'long', quantity: 5, average_price: 200, pnl: 10, market_value: 1000 }]);
    mockGenerateDecision
      .mockResolvedValueOnce(decision({ action: 'open_long' }))   // AAPL entry → blocked
      .mockResolvedValueOnce(decision({ action: 'close' }));      // TSLA exit → allowed
    await runForUser(USER_ID, SETTINGS, EMAIL);
    expect(mockExecuteDecision).toHaveBeenCalledTimes(1);
    expect(mockExecuteDecision.mock.calls[0][0].decision.action).toBe('close');
    expect(mockDailyLossEmail).toHaveBeenCalled();
  });

  // Running cycles against a shut market burns an AI decision per symbol on
  // orders that cannot fill. Gate on the broker clock where the broker has one.
  test('skips the whole cycle when the broker reports the market closed', async () => {
    adapter.capabilities = () => ['market_clock'];
    adapter.isMarketOpen = jest.fn().mockResolvedValue(false);
    await runForUser(USER_ID, SETTINGS, EMAIL);
    expect(mockGenerateDecision).not.toHaveBeenCalled();
    expect(mockBuildMarketContext).not.toHaveBeenCalled();
    expect(lastRunLog()[5]).toBe('market_closed');
  });

  test('runs normally when the broker reports the market open', async () => {
    adapter.capabilities = () => ['market_clock'];
    adapter.isMarketOpen = jest.fn().mockResolvedValue(true);
    await runForUser(USER_ID, SETTINGS, EMAIL);
    expect(mockGenerateDecision).toHaveBeenCalledTimes(1);
  });

  // Brokers without a clock (e.g. 24/7 crypto) must not be gated off.
  test('proceeds when the broker exposes no market clock', async () => {
    adapter.capabilities = () => ['place_order'];
    await runForUser(USER_ID, SETTINGS, EMAIL);
    expect(mockGenerateDecision).toHaveBeenCalledTimes(1);
  });

  test('positions fetch failure fails closed: no decisions at all this cycle', async () => {
    adapter.getPositions.mockRejectedValue(new Error('broker down'));
    await runForUser(USER_ID, SETTINGS, EMAIL);
    expect(mockGenerateDecision).not.toHaveBeenCalled();
    const log = lastRunLog();
    expect(log[5]).toBe('error');
  });

  test('tiered mode screens symbols; screened-out symbols are logged', async () => {
    mockBuildScreeningSummaries.mockResolvedValue({
      summaries: [{ symbol: 'AAPL', has_position: false }, { symbol: 'MSFT', has_position: false }],
      unscreenable: [],
    });
    mockScreenSymbols.mockResolvedValue(['MSFT']);
    await runForUser(USER_ID, { ...SETTINGS, symbols: ['AAPL', 'MSFT'], ai_mode: 'tiered' }, EMAIL);
    const analyzed = mockBuildMarketContext.mock.calls.map(([args]) => args.symbol);
    expect(analyzed).toEqual(['MSFT']);
    const screenedOut = mockDb.none.mock.calls.find(
      ([sql, params]) => /auto_trading_runs/.test(sql) && params[5] === 'screened_out'
    );
    expect(screenedOut).toBeTruthy();
  });

  test('screening failure fails open: everything is analyzed', async () => {
    mockBuildScreeningSummaries.mockResolvedValue({ summaries: [{ symbol: 'AAPL' }, { symbol: 'MSFT' }], unscreenable: [] });
    mockScreenSymbols.mockRejectedValue(new Error('screen down'));
    await runForUser(USER_ID, { ...SETTINGS, symbols: ['AAPL', 'MSFT'], ai_mode: 'tiered' }, EMAIL);
    expect(mockBuildMarketContext).toHaveBeenCalledTimes(2);
  });
});

describe('processSymbol gating', () => {
  const base = () => ({
    userId: USER_ID, userEmail: EMAIL,
    settings: SETTINGS, conn: CONN, adapter,
    mode: { name: 'balanced', contextProfile: 'full', screeningModel: null },
    symbol: 'AAPL', position: null,
    portfolio: { equity: 100000 }, entryBlocked: null, equity: 100000,
  });

  test('hold is logged, not executed', async () => {
    mockGenerateDecision.mockResolvedValue(decision({ action: 'hold', confidence: 30 }));
    await processSymbol(base());
    expect(mockExecuteDecision).not.toHaveBeenCalled();
    expect(lastRunLog()[5]).toBe('hold');
  });

  test('low confidence skips', async () => {
    mockGenerateDecision.mockResolvedValue(decision({ confidence: 50 }));
    await processSymbol(base());
    expect(mockExecuteDecision).not.toHaveBeenCalled();
    expect(lastRunLog()[5]).toBe('skipped_low_confidence');
  });

  test('authority denial skips', async () => {
    const position = { symbol: 'AAPL', position_type: 'long', quantity: 10, average_price: 140, pnl: 50 };
    mockGenerateDecision.mockResolvedValue(decision({ action: 'partial_exit', exit_fraction: 0.5 }));
    await processSymbol({ ...base(), position });
    expect(mockExecuteDecision).not.toHaveBeenCalled();
    expect(lastRunLog()[5]).toBe('skipped_authority');
  });

  test('cooldown blocks entries', async () => {
    mockDb.oneOrNone.mockImplementation((sql) => {
      if (/broker_connections/.test(sql)) return Promise.resolve(CONN);
      if (/cooldown|INTERVAL/.test(sql)) return Promise.resolve({ id: 'recent' });
      return Promise.resolve(null);
    });
    await processSymbol(base());
    expect(mockExecuteDecision).not.toHaveBeenCalled();
    expect(lastRunLog()[5]).toBe('skipped_cooldown');
  });

  test('open_long with an existing position is a conflict skip', async () => {
    const position = { symbol: 'AAPL', position_type: 'short', quantity: 10, average_price: 140, pnl: 0 };
    mockGenerateDecision.mockResolvedValue(decision({ action: 'open_long' }));
    await processSymbol({ ...base(), position });
    expect(mockExecuteDecision).not.toHaveBeenCalled();
    expect(lastRunLog()[5]).toBe('skipped_existing_position');
  });

  test('run log includes action_detail JSON', async () => {
    await processSymbol(base());
    const insert = mockDb.none.mock.calls.find(([sql]) => /INSERT INTO auto_trading_runs/.test(sql));
    const params = insert[1];
    const detail = JSON.parse(params[params.length - 1]);
    expect(detail.decision.action).toBe('open_long');
  });
});
