describe('resolveAiMode', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_MODEL_SMALL;
    delete process.env.ANTHROPIC_MODEL_TOP;
  });

  function load() {
    return require('../../services/aiModes');
  }

  test('balanced is the default and uses the decision model, full context, no thinking', () => {
    const { resolveAiMode } = load();
    for (const input of ['balanced', undefined, 'nonsense']) {
      const mode = resolveAiMode(input);
      expect(mode.name).toBe('balanced');
      expect(mode.decisionModel).toBe('claude-sonnet-4-6');
      expect(mode.screeningModel).toBeNull();
      expect(mode.thinkingBudget).toBeNull();
      expect(mode.contextProfile).toBe('full');
    }
  });

  test('minimize uses the small model with trimmed context', () => {
    const mode = load().resolveAiMode('minimize');
    expect(mode.decisionModel).toBe('claude-haiku-4-5-20251001');
    expect(mode.contextProfile).toBe('trimmed');
    expect(mode.screeningModel).toBeNull();
  });

  test('tiered screens with the small model and decides with the decision model', () => {
    const mode = load().resolveAiMode('tiered');
    expect(mode.screeningModel).toBe('claude-haiku-4-5-20251001');
    expect(mode.decisionModel).toBe('claude-sonnet-4-6');
  });

  test('max uses the top model with extended thinking and maxTokens above the budget', () => {
    const mode = load().resolveAiMode('max');
    expect(mode.decisionModel).toBe('claude-opus-4-8');
    expect(mode.thinkingBudget).toBe(4096);
    expect(mode.maxTokens).toBeGreaterThan(mode.thinkingBudget);
  });

  test('model ids come from env', () => {
    process.env.ANTHROPIC_MODEL = 'custom-decision';
    process.env.ANTHROPIC_MODEL_SMALL = 'custom-small';
    process.env.ANTHROPIC_MODEL_TOP = 'custom-top';
    const { resolveAiMode } = load();
    expect(resolveAiMode('balanced').decisionModel).toBe('custom-decision');
    expect(resolveAiMode('minimize').decisionModel).toBe('custom-small');
    expect(resolveAiMode('max').decisionModel).toBe('custom-top');
  });

  test('AI_MODE_NAMES lists all four modes', () => {
    expect(load().AI_MODE_NAMES).toEqual(['minimize', 'balanced', 'tiered', 'max']);
  });
});
