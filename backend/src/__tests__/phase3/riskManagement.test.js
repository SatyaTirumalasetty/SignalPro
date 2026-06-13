const {
  calculatePositionSize,
  checkDailyLossLimit,
  DEFAULT_RISK_PER_TRADE_PCT,
  DEFAULT_MAX_DAILY_LOSS_PCT,
} = require('../../services/riskManagement');

describe('calculatePositionSize', () => {
  test('returns 0 when stopLoss is missing', () => {
    expect(calculatePositionSize({ equity: 100000, entryPrice: 100, stopLoss: null })).toBe(0);
  });

  test('returns 0 when entryPrice equals stopLoss (zero risk distance)', () => {
    expect(calculatePositionSize({ equity: 100000, entryPrice: 100, stopLoss: 100 })).toBe(0);
  });

  test('sizes position based on 1% risk by default', () => {
    // risk amount = 100000 * 0.01 = 1000; per-unit risk = 100 - 90 = 10 -> 100 shares
    const qty = calculatePositionSize({ equity: 100000, entryPrice: 100, stopLoss: 90 });
    expect(qty).toBe(100);
  });

  test('caps position size by what equity can afford', () => {
    // risk-based qty would be huge (tiny stop distance), but equity/entryPrice caps it
    const qty = calculatePositionSize({ equity: 1000, entryPrice: 100, stopLoss: 99.99 });
    expect(qty).toBe(10); // 1000 / 100
  });

  test('respects a custom riskPerTradePct', () => {
    // risk amount = 100000 * 0.02 = 2000; per-unit risk = 10 -> 200 shares
    const qty = calculatePositionSize({ equity: 100000, riskPerTradePct: 0.02, entryPrice: 100, stopLoss: 90 });
    expect(qty).toBe(200);
  });

  test('default risk constant is 1%', () => {
    expect(DEFAULT_RISK_PER_TRADE_PCT).toBe(0.01);
  });
});

describe('checkDailyLossLimit', () => {
  function mockDb(realizedPnl) {
    return { one: jest.fn().mockResolvedValue({ realized_pnl: String(realizedPnl) }) };
  }

  test('does not throw when no equity is provided', async () => {
    const db = mockDb(-1000);
    await expect(checkDailyLossLimit({ db, userId: 'u1', equity: null })).resolves.toBeUndefined();
  });

  test('does not throw when losses are below the limit', async () => {
    // -1% of 100000 = -1000, limit is 3% = -3000, so -1000 is fine
    const db = mockDb(-1000);
    await expect(checkDailyLossLimit({ db, userId: 'u1', equity: 100000 })).resolves.toBeUndefined();
  });

  test('throws RISK_LIMIT_EXCEEDED when losses meet the daily limit', async () => {
    // -3% of 100000 = -3000, matches default 3% limit
    const db = mockDb(-3000);
    await expect(checkDailyLossLimit({ db, userId: 'u1', equity: 100000 }))
      .rejects.toMatchObject({ code: 'RISK_LIMIT_EXCEEDED', status: 403 });
  });

  test('respects a custom maxDailyLossPct', async () => {
    const db = mockDb(-500);
    await expect(checkDailyLossLimit({ db, userId: 'u1', equity: 10000, maxDailyLossPct: 0.05 }))
      .rejects.toMatchObject({ code: 'RISK_LIMIT_EXCEEDED' });
  });

  test('default daily loss limit constant is 3%', () => {
    expect(DEFAULT_MAX_DAILY_LOSS_PCT).toBe(0.03);
  });
});
