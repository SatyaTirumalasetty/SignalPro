const mockGetHistoricalData = jest.fn();
const mockCalculateAll = jest.fn();
const mockGetNews = jest.fn();

jest.mock('../../services/marketData', () => ({ getHistoricalData: mockGetHistoricalData }));
jest.mock('../../services/indicators', () => ({ calculateAll: mockCalculateAll }));
jest.mock('../../services/alpacaMarketData', () => ({ getNews: mockGetNews }));

const { buildMarketContext, buildScreeningSummaries } = require('../../services/marketContext');

function candles(n) {
  return Array.from({ length: n }, (_, i) => ({
    time: `2026-07-08T0${i % 10}:00`, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 1000,
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetHistoricalData.mockResolvedValue({ current_price: 150, previous_close: 148, candles: candles(50) });
  mockCalculateAll.mockReturnValue({ rsi_14: 55 });
  mockGetNews.mockResolvedValue([{ headline: 'h', source: 's', created_at: '2026-07-08' }]);
});

describe('buildMarketContext', () => {
  test('full profile: all timeframes, 20 candles each, news included', async () => {
    const ctx = await buildMarketContext({
      symbol: 'AAPL', timeframes: ['15m', '1h', '4h', '1d'], contextProfile: 'full',
      position: null, portfolio: { equity: 100000 },
    });
    expect(Object.keys(ctx.timeframes)).toEqual(['15m', '1h', '4h', '1d']);
    expect(ctx.timeframes['1h'].candles).toHaveLength(20);
    expect(ctx.timeframes['1h'].indicators).toEqual({ rsi_14: 55 });
    expect(ctx.news).toHaveLength(1);
    expect(ctx.current_price).toBe(150);
    expect(ctx.portfolio.equity).toBe(100000);
  });

  test('trimmed profile: first 2 timeframes, 5 candles, no news', async () => {
    const ctx = await buildMarketContext({
      symbol: 'AAPL', timeframes: ['15m', '1h', '4h', '1d'], contextProfile: 'trimmed',
    });
    expect(Object.keys(ctx.timeframes)).toEqual(['15m', '1h']);
    expect(ctx.timeframes['15m'].candles).toHaveLength(5);
    expect(ctx.news).toEqual([]);
    expect(mockGetNews).not.toHaveBeenCalled();
  });

  test('throws when no timeframe has data', async () => {
    mockGetHistoricalData.mockResolvedValue({ current_price: null, previous_close: null, candles: [] });
    await expect(buildMarketContext({ symbol: 'XX', timeframes: ['1h'] }))
      .rejects.toThrow(/No market data available for XX/);
  });

  test('news failure is non-fatal', async () => {
    mockGetNews.mockRejectedValue(new Error('news down'));
    const ctx = await buildMarketContext({ symbol: 'AAPL', timeframes: ['1h'], contextProfile: 'full' });
    expect(ctx.news).toEqual([]);
  });
});

describe('buildScreeningSummaries', () => {
  test('summarizes symbols and flags positions', async () => {
    const { summaries, unscreenable } = await buildScreeningSummaries(
      ['AAPL', 'MSFT'], new Map([['MSFT', { symbol: 'MSFT' }]])
    );
    expect(unscreenable).toEqual([]);
    expect(summaries).toEqual([
      { symbol: 'AAPL', current_price: 150, change_pct: 1.35, rsi_14: 55, has_position: false },
      { symbol: 'MSFT', current_price: 150, change_pct: 1.35, rsi_14: 55, has_position: true },
    ]);
  });

  test('fetch failures land in unscreenable', async () => {
    mockGetHistoricalData
      .mockResolvedValueOnce({ current_price: 150, previous_close: 148, candles: candles(50) })
      .mockRejectedValueOnce(new Error('feed down'));
    const { summaries, unscreenable } = await buildScreeningSummaries(['AAPL', 'BAD'], new Map());
    expect(summaries.map((s) => s.symbol)).toEqual(['AAPL']);
    expect(unscreenable).toEqual(['BAD']);
  });
});
