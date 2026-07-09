const mockPlaceOrder = jest.fn();
jest.mock('../../services/orderExecution', () => ({ placeOrder: mockPlaceOrder }));

const mockActionEmail = jest.fn();
const mockAttentionEmail = jest.fn();
jest.mock('../../services/emailService', () => ({
  sendAutoTradingActionEmail: mockActionEmail,
  sendAutoTradingNeedsAttentionEmail: mockAttentionEmail,
}));

const { executeDecision } = require('../../services/engineActions');

const CONN = { id: 'conn-1', broker_id: 'alpaca', credentials_encrypted: 'enc' };
const SETTINGS = { risk_per_trade_pct: 0.01 };
const LONG_POSITION = { symbol: 'AAPL', position_type: 'long', quantity: 10, average_price: 140, pnl: 100 };

function makeAdapter(overrides = {}) {
  return {
    capabilities: () => ['place_order', 'cancel_order', 'close_position', 'replace_order', 'open_orders'],
    getOpenOrders: jest.fn().mockResolvedValue([]),
    cancelOrder: jest.fn().mockResolvedValue(true),
    closePosition: jest.fn().mockResolvedValue({ order_id: 'b-1', status: 'pending', message: 'ok' }),
    replaceOrder: jest.fn().mockResolvedValue({ order_id: 'b-2', status: 'pending', message: 'ok' }),
    ...overrides,
  };
}

function decision(overrides = {}) {
  return {
    action: 'open_long', confidence: 80, reasoning: 'r', timeframe_alignment: {},
    entry_price: 150, stop_loss: 145, take_profit: 160, exit_fraction: null,
    risk_reward: 2, invalidation: 'x', id: 'sig-1',
    ...overrides,
  };
}

function run(overrides = {}) {
  return executeDecision({
    db: {}, adapter: makeAdapter(), conn: CONN, userId: 'user-1', userEmail: 'u@x.com',
    settings: SETTINGS, symbol: 'AAPL', position: null, decision: decision(), equity: 100000,
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPlaceOrder.mockResolvedValue({ id: 'order-1' });
  mockActionEmail.mockResolvedValue(undefined);
  mockAttentionEmail.mockResolvedValue(undefined);
});

describe('capability gating', () => {
  test('unsupported broker is skipped, never a silent no-op', async () => {
    const adapter = { capabilities: () => [] };
    const res = await run({ adapter });
    expect(res.action).toBe('skipped_unsupported_broker');
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });
});

describe('open_long / open_short', () => {
  test('sizes via risk and places a bracket market order', async () => {
    const res = await run();
    // equity 100000 * 1% = 1000 risk; per-unit risk 5 → 200; affordable 666 → 200
    expect(mockPlaceOrder).toHaveBeenCalledWith(expect.objectContaining({
      symbol: 'AAPL', side: 'buy', quantity: 200, stopLoss: 145, takeProfit: 160,
      signalId: 'sig-1', source: 'auto_engine',
    }));
    expect(res).toMatchObject({ action: 'order_placed', orderId: 'order-1' });
  });

  test('open_short sells', async () => {
    await run({ decision: decision({ action: 'open_short' }) });
    expect(mockPlaceOrder).toHaveBeenCalledWith(expect.objectContaining({ side: 'sell' }));
  });

  test('zero sizing skips', async () => {
    const res = await run({ equity: 0 });
    expect(res.action).toBe('skipped_risk_sizing');
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });
});

describe('add', () => {
  test('adds in the direction of the position', async () => {
    const res = await run({ position: LONG_POSITION, decision: decision({ action: 'add', id: null }) });
    expect(mockPlaceOrder).toHaveBeenCalledWith(expect.objectContaining({ side: 'buy', source: 'auto_engine' }));
    expect(res.action).toBe('position_added');
  });
});

describe('close', () => {
  test('cancels open orders then closes; emails the action', async () => {
    const adapter = makeAdapter({
      getOpenOrders: jest.fn().mockResolvedValue([
        { broker_order_id: 'stop-1', order_type: 'stop', stop_price: 145 },
      ]),
    });
    const res = await run({ adapter, position: LONG_POSITION, decision: decision({ action: 'close' }) });
    expect(adapter.cancelOrder).toHaveBeenCalledWith('stop-1');
    expect(adapter.closePosition).toHaveBeenCalledWith('AAPL');
    expect(res.action).toBe('position_closed');
    expect(mockActionEmail).toHaveBeenCalled();
  });

  test('close failure AFTER cancels is needs_attention with email', async () => {
    const adapter = makeAdapter({
      getOpenOrders: jest.fn().mockResolvedValue([{ broker_order_id: 'stop-1', order_type: 'stop', stop_price: 145 }]),
      closePosition: jest.fn().mockRejectedValue(new Error('rejected')),
    });
    const res = await run({ adapter, position: LONG_POSITION, decision: decision({ action: 'close' }) });
    expect(res.action).toBe('needs_attention');
    expect(mockAttentionEmail).toHaveBeenCalledWith('u@x.com', expect.objectContaining({ symbol: 'AAPL' }));
  });

  test('cancel failure BEFORE close is a plain error (position still protected)', async () => {
    const adapter = makeAdapter({
      getOpenOrders: jest.fn().mockRejectedValue(new Error('api down')),
    });
    const res = await run({ adapter, position: LONG_POSITION, decision: decision({ action: 'close' }) });
    expect(res.action).toBe('error');
    expect(adapter.closePosition).not.toHaveBeenCalled();
  });
});

describe('partial_exit', () => {
  test('closes the computed fraction', async () => {
    const adapter = makeAdapter();
    const res = await run({
      adapter, position: LONG_POSITION,
      decision: decision({ action: 'partial_exit', exit_fraction: 0.5 }),
    });
    expect(adapter.closePosition).toHaveBeenCalledWith('AAPL', 5);
    expect(res.action).toBe('partial_exit');
    expect(res.detail).toMatchObject({ quantity: 5, remaining: 5, unprotected_remainder: true });
  });

  test('unsizable fraction skips', async () => {
    const res = await run({
      position: { ...LONG_POSITION, quantity: 1 },
      decision: decision({ action: 'partial_exit', exit_fraction: 0.5 }),
    });
    expect(res.action).toBe('skipped_risk_sizing');
  });
});

describe('adjust_stop', () => {
  test('replaces the open stop order when tightening', async () => {
    const adapter = makeAdapter({
      getOpenOrders: jest.fn().mockResolvedValue([{ broker_order_id: 'stop-1', order_type: 'stop', stop_price: 145 }]),
    });
    const res = await run({
      adapter, position: LONG_POSITION,
      decision: decision({ action: 'adjust_stop', stop_loss: 148 }),
    });
    expect(adapter.replaceOrder).toHaveBeenCalledWith('stop-1', { stop_price: 148 });
    expect(res.action).toBe('stop_adjusted');
    expect(res.detail).toMatchObject({ from: 145, to: 148 });
  });

  test('widening is refused deterministically', async () => {
    const adapter = makeAdapter({
      getOpenOrders: jest.fn().mockResolvedValue([{ broker_order_id: 'stop-1', order_type: 'stop', stop_price: 145 }]),
    });
    const res = await run({
      adapter, position: LONG_POSITION,
      decision: decision({ action: 'adjust_stop', stop_loss: 140 }),
    });
    expect(res.action).toBe('skipped_stop_widening');
    expect(adapter.replaceOrder).not.toHaveBeenCalled();
  });

  test('no open stop order is an error', async () => {
    const res = await run({
      position: LONG_POSITION,
      decision: decision({ action: 'adjust_stop', stop_loss: 148 }),
    });
    expect(res.action).toBe('error');
    expect(res.errorMessage).toMatch(/no open stop order/i);
  });
});
