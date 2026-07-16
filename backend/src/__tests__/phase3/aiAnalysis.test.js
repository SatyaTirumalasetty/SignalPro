const mockDb = {
  one: jest.fn(),
  oneOrNone: jest.fn(),
  none: jest.fn(),
  manyOrNone: jest.fn(),
};

const mockMessageCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () =>
  jest.fn().mockImplementation(() => ({
    messages: { create: mockMessageCreate },
  }))
);
jest.mock('../../config/database', () => ({ db: mockDb }));
jest.mock('../../config/redis', () => ({
  cacheGet: jest.fn().mockResolvedValue(null),
  cacheSet: jest.fn().mockResolvedValue(undefined),
}));

const { cacheGet, cacheSet } = require('../../config/redis');
const { generateSignal } = require('../../services/aiAnalysis');

const MOCK_PRICE_DATA = {
  symbol: 'AAPL',
  price: 150.00,
  current_price: 150.00,
  previous_close: 148.50,
  candles: Array.from({ length: 5 }, (_, i) => ({
    time: new Date(1700000000000 + i * 3600000).toISOString(),
    open: 149 + i * 0.5, high: 151 + i * 0.5,
    low: 148 + i * 0.5, close: 150 + i * 0.5, volume: 1_000_000,
  })),
};

const MOCK_INDICATORS = {
  rsi_14: 62, sma_20: 148, ema_12: 149, macd: { macd: 0.5, signal: 0.3, histogram: 0.2 },
  bollinger_bands: { upper: 155, middle: 150, lower: 145 }, vwap: 150,
  stochastic: { k: 65, d: 65 }, atr_14: 2.5, current_price: 150,
};

const VALID_AI_RESPONSE = {
  signal: 'buy',
  confidence: 72,
  reasoning: 'RSI crossing 60 with MACD bullish divergence.',
  entry_price: 150.00,
  stop_loss: 146.00,
  take_profit: 158.00,
  predicted_high: 158.00,
  predicted_low: 147.00,
  risk_reward: 2.0,
  key_levels: { support: 146.00, resistance: 155.00 },
  timeframe_bias: 'medium',
  catalysts: ['earnings', 'sector rotation'],
};

const USER_ID = 'user-uuid-123';

beforeEach(() => {
  // clearAllMocks preserves mock implementations (Anthropic constructor); only clears call history
  jest.clearAllMocks();
  cacheGet.mockResolvedValue(null);
  cacheSet.mockResolvedValue(undefined);
  mockDb.one.mockResolvedValue({ id: 'signal-uuid', created_at: new Date() });
  mockDb.none.mockResolvedValue(undefined);
  process.env.ANTHROPIC_API_KEY = 'test-key';
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe('generateSignal()', () => {
  test('returns signal object for valid AI response', async () => {
    mockMessageCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify(VALID_AI_RESPONSE) }],
      usage: { input_tokens: 400, output_tokens: 200 },
    });

    const result = await generateSignal(USER_ID, 'AAPL', '1h', MOCK_PRICE_DATA, MOCK_INDICATORS);

    expect(result.signal).toBe('buy');
    expect(result.confidence).toBe(72);
    expect(result.symbol).toBe('AAPL');
    expect(result.timeframe).toBe('1h');
    expect(result.cached).toBe(false);
  });

  test('ai_tokens_used is sum of input + output tokens', async () => {
    mockMessageCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify(VALID_AI_RESPONSE) }],
      usage: { input_tokens: 400, output_tokens: 200 },
    });

    const result = await generateSignal(USER_ID, 'AAPL', '1h', MOCK_PRICE_DATA, MOCK_INDICATORS);
    expect(result.ai_tokens_used).toBe(600);
  });

  test('returns cached signal without calling AI', async () => {
    const cachedSignal = { ...VALID_AI_RESPONSE, user_id: 'other-user', symbol: 'AAPL', timeframe: '1h' };
    cacheGet.mockResolvedValueOnce(cachedSignal);

    const result = await generateSignal(USER_ID, 'AAPL', '1h', MOCK_PRICE_DATA, MOCK_INDICATORS);
    expect(result.cached).toBe(true);
    expect(mockMessageCreate).not.toHaveBeenCalled();
  });

  test('throws 503 when ANTHROPIC_API_KEY not set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    cacheGet.mockResolvedValue(null);

    await expect(generateSignal(USER_ID, 'AAPL', '1h', MOCK_PRICE_DATA, MOCK_INDICATORS))
      .rejects.toMatchObject({ status: 503 });
  });

  test('throws 502 when every attempt returns malformed JSON', async () => {
    mockMessageCreate.mockResolvedValue({
      content: [{ text: 'This is not JSON' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    await expect(generateSignal(USER_ID, 'AAPL', '1h', MOCK_PRICE_DATA, MOCK_INDICATORS))
      .rejects.toMatchObject({ status: 502 });
    expect(mockMessageCreate).toHaveBeenCalledTimes(2);
  });

  test('retries once on malformed JSON, then succeeds', async () => {
    mockMessageCreate
      .mockResolvedValueOnce({ content: [{ text: 'oops' }], usage: { input_tokens: 10, output_tokens: 5 } })
      .mockResolvedValueOnce({
        content: [{ text: JSON.stringify(VALID_AI_RESPONSE) }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

    const result = await generateSignal(USER_ID, 'AAPL', '1h', MOCK_PRICE_DATA, MOCK_INDICATORS);
    expect(result.signal).toBe('buy');
    expect(mockMessageCreate).toHaveBeenCalledTimes(2);
  });

  test('parses JSON wrapped in markdown fences', async () => {
    mockMessageCreate.mockResolvedValueOnce({
      content: [{ text: '```json\n' + JSON.stringify(VALID_AI_RESPONSE) + '\n```' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const result = await generateSignal(USER_ID, 'AAPL', '1h', MOCK_PRICE_DATA, MOCK_INDICATORS);
    expect(result.signal).toBe('buy');
    expect(mockMessageCreate).toHaveBeenCalledTimes(1);
  });

  test('parses JSON preceded by preamble text', async () => {
    mockMessageCreate.mockResolvedValueOnce({
      content: [{ text: 'Here is the analysis:\n' + JSON.stringify(VALID_AI_RESPONSE) }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const result = await generateSignal(USER_ID, 'AAPL', '1h', MOCK_PRICE_DATA, MOCK_INDICATORS);
    expect(result.signal).toBe('buy');
  });

  test('throws 502 for invalid signal type', async () => {
    mockMessageCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({ ...VALID_AI_RESPONSE, signal: 'strong_buy' }) }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    await expect(generateSignal(USER_ID, 'AAPL', '1h', MOCK_PRICE_DATA, MOCK_INDICATORS))
      .rejects.toMatchObject({ status: 502 });
  });

  test('accepts sell signal', async () => {
    mockMessageCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({ ...VALID_AI_RESPONSE, signal: 'sell', confidence: 68 }) }],
      usage: { input_tokens: 400, output_tokens: 200 },
    });

    const result = await generateSignal(USER_ID, 'AAPL', '1h', MOCK_PRICE_DATA, MOCK_INDICATORS);
    expect(result.signal).toBe('sell');
  });

  test('accepts hold signal', async () => {
    mockMessageCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({ ...VALID_AI_RESPONSE, signal: 'hold', confidence: 45 }) }],
      usage: { input_tokens: 400, output_tokens: 200 },
    });

    const result = await generateSignal(USER_ID, 'AAPL', '1h', MOCK_PRICE_DATA, MOCK_INDICATORS);
    expect(result.signal).toBe('hold');
  });

  test('confidence is clamped to 0-100', async () => {
    mockMessageCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({ ...VALID_AI_RESPONSE, confidence: 150 }) }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const result = await generateSignal(USER_ID, 'AAPL', '1h', MOCK_PRICE_DATA, MOCK_INDICATORS);
    expect(result.confidence).toBe(100);
  });

  test('caches result after generation', async () => {
    mockMessageCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify(VALID_AI_RESPONSE) }],
      usage: { input_tokens: 400, output_tokens: 200 },
    });

    await generateSignal(USER_ID, 'AAPL', '1h', MOCK_PRICE_DATA, MOCK_INDICATORS);
    expect(cacheSet).toHaveBeenCalledWith('signal:AAPL:1h', expect.any(Object), 300);
  });

  test('throws 502 when Anthropic API fails', async () => {
    mockMessageCreate.mockRejectedValueOnce(new Error('API overloaded'));

    await expect(generateSignal(USER_ID, 'AAPL', '1h', MOCK_PRICE_DATA, MOCK_INDICATORS))
      .rejects.toMatchObject({ status: 502 });
  });

  test('includes indicators in returned signal', async () => {
    mockMessageCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify(VALID_AI_RESPONSE) }],
      usage: { input_tokens: 400, output_tokens: 200 },
    });

    const result = await generateSignal(USER_ID, 'AAPL', '1h', MOCK_PRICE_DATA, MOCK_INDICATORS);
    expect(result.indicators).toEqual(MOCK_INDICATORS);
  });

  describe('with news headlines', () => {
    const MOCK_NEWS = [
      { id: 1, headline: 'Apple unveils new product', source: 'Benzinga', created_at: '2024-01-01T00:00:00Z' },
    ];

    test('folds news into the returned indicators', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        content: [{ text: JSON.stringify(VALID_AI_RESPONSE) }],
        usage: { input_tokens: 400, output_tokens: 200 },
      });

      const result = await generateSignal(USER_ID, 'AAPL', '1h', MOCK_PRICE_DATA, MOCK_INDICATORS, MOCK_NEWS);
      expect(result.indicators.news).toEqual(MOCK_NEWS);
      expect(result.indicators.rsi_14).toBe(MOCK_INDICATORS.rsi_14);
    });

    test('includes news headlines in the prompt sent to the AI', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        content: [{ text: JSON.stringify(VALID_AI_RESPONSE) }],
        usage: { input_tokens: 400, output_tokens: 200 },
      });

      await generateSignal(USER_ID, 'AAPL', '1h', MOCK_PRICE_DATA, MOCK_INDICATORS, MOCK_NEWS);
      const promptArg = mockMessageCreate.mock.calls[0][0].messages[0].content;
      expect(promptArg).toContain('Recent News Headlines');
      expect(promptArg).toContain('Apple unveils new product');
    });

    test('persists news-enriched indicators to the database', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        content: [{ text: JSON.stringify(VALID_AI_RESPONSE) }],
        usage: { input_tokens: 400, output_tokens: 200 },
      });

      await generateSignal(USER_ID, 'AAPL', '1h', MOCK_PRICE_DATA, MOCK_INDICATORS, MOCK_NEWS);
      const insertParams = mockDb.one.mock.calls[0][1];
      const indicatorsJson = insertParams[13];
      expect(JSON.parse(indicatorsJson).news).toEqual(MOCK_NEWS);
    });

    test('prompt notes when no news is available', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        content: [{ text: JSON.stringify(VALID_AI_RESPONSE) }],
        usage: { input_tokens: 400, output_tokens: 200 },
      });

      await generateSignal(USER_ID, 'AAPL', '1h', MOCK_PRICE_DATA, MOCK_INDICATORS);
      const promptArg = mockMessageCreate.mock.calls[0][0].messages[0].content;
      expect(promptArg).toContain('None available.');
      expect(mockDb.one.mock.calls[0][1][13]).not.toContain('"news"');
    });
  });

  test('falls back to incrementing usage_metrics when the insert conflicts', async () => {
    mockMessageCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify(VALID_AI_RESPONSE) }],
      usage: { input_tokens: 400, output_tokens: 200 },
    });
    mockDb.none
      .mockResolvedValueOnce(undefined) // signal_cache upsert
      .mockRejectedValueOnce(new Error('duplicate key')) // usage_metrics insert
      .mockResolvedValueOnce(undefined); // usage_metrics update fallback

    await generateSignal(USER_ID, 'AAPL', '1h', MOCK_PRICE_DATA, MOCK_INDICATORS);

    expect(mockDb.none).toHaveBeenCalledTimes(3);
    expect(mockDb.none.mock.calls[2][0]).toContain('UPDATE usage_metrics');
  });
});
