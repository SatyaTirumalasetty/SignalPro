const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({
  messages: { create: mockCreate },
})));

const mockDb = { one: jest.fn(), none: jest.fn() };
jest.mock('../../config/database', () => ({ db: mockDb }));
jest.mock('../../config/redis', () => ({ cacheGet: jest.fn(), cacheSet: jest.fn() }));

const { generateDecision, screenSymbols } = require('../../services/aiAnalysis');

const MODE = {
  name: 'balanced', screeningModel: null, decisionModel: 'model-x',
  maxTokens: 1500, effort: null, contextProfile: 'full',
};

const CONTEXT = {
  symbol: 'AAPL', current_price: 150, previous_close: 148,
  timeframes: { '1h': { candles: [{ time: '2026-07-08T10:00', open: 149, high: 151, low: 148, close: 150, volume: 1 }], indicators: { rsi_14: 55 } } },
  news: [], position: null, portfolio: { equity: 100000, open_positions: 0, exposure_pct: 0, todays_realized_pnl: 0 },
};

function claudeText(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: 100, output_tokens: 50 } };
}

const GOOD = {
  action: 'open_long', confidence: 82, reasoning: 'aligned', timeframe_alignment: { '1h': 'bullish' },
  entry_price: 150, stop_loss: 145, take_profit: 160, exit_fraction: null, risk_reward: 2, invalidation: 'close < 145',
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'test-key';
  mockDb.one.mockResolvedValue({ id: 'sig-1', created_at: '2026-07-08' });
  mockDb.none.mockResolvedValue(undefined);
  mockCreate.mockResolvedValue(claudeText(GOOD));
});

describe('generateDecision', () => {
  test('returns validated decision and persists a signal row for entries', async () => {
    const d = await generateDecision('user-1', CONTEXT, MODE);
    expect(d.action).toBe('open_long');
    expect(d.id).toBe('sig-1');
    expect(d.ai_model).toBe('model-x');
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: 'model-x', max_tokens: 1500 }));
    expect(mockDb.one).toHaveBeenCalledWith(expect.stringContaining('historical_signals'), expect.any(Array));
  });

  test('does not persist a signal row for hold/close', async () => {
    mockCreate.mockResolvedValue(claudeText({ action: 'hold', confidence: 40, reasoning: 'chop' }));
    const d = await generateDecision('user-1', CONTEXT, MODE);
    expect(d.action).toBe('hold');
    expect(d.id).toBeNull();
    expect(mockDb.one).not.toHaveBeenCalled();
  });

  test('retries once on malformed JSON, then succeeds', async () => {
    mockCreate
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'not json' }], usage: {} })
      .mockResolvedValueOnce(claudeText(GOOD));
    const d = await generateDecision('user-1', CONTEXT, MODE);
    expect(d.action).toBe('open_long');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  test('throws 502 after two invalid responses — never guesses a trade', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: '{"action":"yolo"}' }], usage: {} });
    await expect(generateDecision('user-1', CONTEXT, MODE)).rejects.toMatchObject({ status: 502 });
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  test('position actions validate against hasPosition from context', async () => {
    mockCreate.mockResolvedValue(claudeText({ ...GOOD, action: 'close' }));
    await expect(generateDecision('user-1', CONTEXT, MODE)).rejects.toMatchObject({ status: 502 });

    mockCreate.mockResolvedValue(claudeText({ ...GOOD, action: 'close' }));
    const withPos = { ...CONTEXT, position: { symbol: 'AAPL', position_type: 'long', quantity: 10, average_price: 140, pnl: 100 } };
    const d = await generateDecision('user-1', withPos, MODE);
    expect(d.action).toBe('close');
  });

  test('max mode sends adaptive thinking with effort config', async () => {
    const maxMode = { ...MODE, decisionModel: 'model-top', maxTokens: 16000, effort: 'xhigh' };
    await generateDecision('user-1', CONTEXT, maxMode);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'model-top',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'xhigh' },
    }));
  });
});

describe('screenSymbols', () => {
  test('returns the analyze list from the screening model', async () => {
    mockCreate.mockResolvedValue(claudeText({ analyze: ['AAPL'] }));
    const mode = { ...MODE, screeningModel: 'model-small' };
    const picked = await screenSymbols(
      [{ symbol: 'AAPL', current_price: 150, change_pct: 1.4, rsi_14: 55, has_position: false }], mode
    );
    expect(picked).toEqual(['AAPL']);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: 'model-small' }));
  });

  test('throws on malformed screening output', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'nope' }], usage: {} });
    await expect(screenSymbols([], { ...MODE, screeningModel: 'model-small' })).rejects.toThrow();
  });
});
