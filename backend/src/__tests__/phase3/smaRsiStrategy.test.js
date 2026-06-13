const { generateSignal } = require('../../services/strategies/smaRsiStrategy');

describe('smaRsiStrategy.generateSignal', () => {
  test('returns hold when indicators are incomplete', () => {
    expect(generateSignal({ ema_12: null, ema_26: 1, rsi_14: 50, sma_50: 1, current_price: 1 })).toBe('hold');
    expect(generateSignal({})).toBe('hold');
  });

  test('returns buy on bullish trend with healthy RSI', () => {
    const signal = generateSignal({ ema_12: 105, ema_26: 100, rsi_14: 55, sma_50: 95, current_price: 110 });
    expect(signal).toBe('buy');
  });

  test('returns sell when fast EMA crosses below slow EMA', () => {
    const signal = generateSignal({ ema_12: 95, ema_26: 100, rsi_14: 55, sma_50: 95, current_price: 96 });
    expect(signal).toBe('sell');
  });

  test('returns sell when RSI is overbought even in an uptrend', () => {
    const signal = generateSignal({ ema_12: 105, ema_26: 100, rsi_14: 85, sma_50: 95, current_price: 110 });
    expect(signal).toBe('sell');
  });

  test('returns hold when price is below sma_50 despite bullish EMA', () => {
    const signal = generateSignal({ ema_12: 105, ema_26: 100, rsi_14: 55, sma_50: 120, current_price: 110 });
    expect(signal).toBe('hold');
  });
});
