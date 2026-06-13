const mockGetHistoricalData = jest.fn();
const mockGenerateSignal = jest.fn();
const mockCalculateAll = jest.fn();

jest.mock('../../services/marketData', () => ({ getHistoricalData: mockGetHistoricalData }));
jest.mock('../../services/strategies/smaRsiStrategy', () => ({ generateSignal: mockGenerateSignal }));
jest.mock('../../services/indicators', () => ({ calculateAll: mockCalculateAll }));

const { runBacktest } = require('../../services/backtest');

beforeEach(() => {
  jest.clearAllMocks();
  mockCalculateAll.mockReturnValue({ atr_14: 2 });
});

describe('runBacktest', () => {
  test('handles too few candles gracefully', async () => {
    mockGetHistoricalData.mockResolvedValue({ candles: [{ close: 100, high: 100, low: 100, time: 't0' }] });

    const result = await runBacktest({ symbol: 'AAPL' });

    expect(result.trades).toEqual([]);
    expect(result.equity_curve).toEqual([]);
    expect(result.summary.total_trades).toBe(0);
    expect(result.summary.total_return_pct).toBe(0);
    expect(result.summary.max_drawdown_pct).toBe(0);
  });

  test('simulates a full buy -> take-profit trade lifecycle', async () => {
    const candles = [
      { close: 99,  high: 100, low: 98,  time: 't0' },
      { close: 100, high: 101, low: 99,  time: 't1' }, // entry: buy at 100, atr=2 -> stop=96, target=106
      { close: 102, high: 103, low: 101, time: 't2' }, // holding
      { close: 108, high: 108, low: 105, time: 't3' }, // take-profit hit (high >= 106)
      { close: 110, high: 111, low: 108, time: 't4' }, // no new position
    ];
    mockGetHistoricalData.mockResolvedValue({ candles });
    mockGenerateSignal
      .mockReturnValueOnce('buy')  // i=1: open position
      .mockReturnValueOnce('hold') // i=2: stay in position
      .mockReturnValueOnce('hold') // i=3: after take-profit exit, decide not to re-enter
      .mockReturnValueOnce('hold'); // i=4: no entry

    const result = await runBacktest({ symbol: 'AAPL', initialEquity: 100000 });

    expect(result.equity_curve).toHaveLength(4);
    expect(result.trades).toHaveLength(1);

    const trade = result.trades[0];
    expect(trade.entry_price).toBe(100);
    expect(trade.exit_price).toBe(106);
    expect(trade.quantity).toBe(250); // risk 1% of 100k / (100-96) = 250
    expect(trade.pnl).toBe(1500);
    expect(trade.exit_reason).toBe('take_profit');

    expect(result.summary.total_trades).toBe(1);
    expect(result.summary.win_count).toBe(1);
    expect(result.summary.total_return_pct).toBe(1.5);
    expect(result.summary.final_equity).toBe(101500);
  });
});
