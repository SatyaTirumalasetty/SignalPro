const {
  validateDecision, VALID_ACTIONS, ENTRY_ACTIONS, POSITION_ACTIONS,
} = require('../../services/decisionSchema');

const openLong = {
  action: 'open_long', confidence: 80, reasoning: 'trend up',
  timeframe_alignment: { '1h': 'bullish' },
  entry_price: 100, stop_loss: 95, take_profit: 110,
  exit_fraction: null, risk_reward: 2, invalidation: 'close below 95',
};

describe('validateDecision', () => {
  test('accepts a valid open_long without a position', () => {
    const res = validateDecision(openLong, { hasPosition: false });
    expect(res.ok).toBe(true);
    expect(res.decision.action).toBe('open_long');
    expect(res.decision.confidence).toBe(80);
  });

  test('rejects unknown action', () => {
    const res = validateDecision({ ...openLong, action: 'yolo' }, { hasPosition: false });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/action/);
  });

  test('rejects position actions without an open position', () => {
    for (const action of POSITION_ACTIONS) {
      const res = validateDecision({ ...openLong, action, exit_fraction: 0.5 }, { hasPosition: false });
      expect(res.ok).toBe(false);
    }
  });

  test('rejects open_long/open_short without stop_loss', () => {
    const res = validateDecision({ ...openLong, stop_loss: null }, { hasPosition: false });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/stop_loss/);
  });

  test('rejects partial_exit without exit_fraction in (0,1)', () => {
    for (const exit_fraction of [null, 0, 1, 1.5]) {
      const res = validateDecision(
        { ...openLong, action: 'partial_exit', exit_fraction }, { hasPosition: true }
      );
      expect(res.ok).toBe(false);
    }
    const ok = validateDecision(
      { ...openLong, action: 'partial_exit', exit_fraction: 0.5 }, { hasPosition: true }
    );
    expect(ok.ok).toBe(true);
  });

  test('rejects adjust_stop without stop_loss', () => {
    const res = validateDecision(
      { ...openLong, action: 'adjust_stop', stop_loss: null }, { hasPosition: true }
    );
    expect(res.ok).toBe(false);
  });

  test('clamps confidence to integer 0-100 and defaults optionals to null', () => {
    const res = validateDecision(
      { action: 'hold', confidence: 150.7, reasoning: 'r' }, { hasPosition: false }
    );
    expect(res.ok).toBe(true);
    expect(res.decision.confidence).toBe(100);
    expect(res.decision.entry_price).toBeNull();
    expect(res.decision.invalidation).toBeNull();
  });

  test('exports action constants', () => {
    expect(VALID_ACTIONS).toContain('hold');
    expect(ENTRY_ACTIONS).toEqual(['open_long', 'open_short', 'add']);
    expect(POSITION_ACTIONS).toEqual(['close', 'adjust_stop', 'partial_exit', 'add']);
  });
});
