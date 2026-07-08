// User-selectable AI cost/intelligence posture for the autonomous engine.
// Model ids come from env so upgrades never require a code change.

function models() {
  return {
    small: process.env.ANTHROPIC_MODEL_SMALL || 'claude-haiku-4-5-20251001',
    decision: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    top: process.env.ANTHROPIC_MODEL_TOP || 'claude-opus-4-8',
  };
}

const AI_MODE_NAMES = ['minimize', 'balanced', 'tiered', 'max'];

function resolveAiMode(name) {
  const m = models();
  const modes = {
    minimize: { screeningModel: null, decisionModel: m.small, maxTokens: 1024, thinkingBudget: null, contextProfile: 'trimmed' },
    balanced: { screeningModel: null, decisionModel: m.decision, maxTokens: 1500, thinkingBudget: null, contextProfile: 'full' },
    tiered: { screeningModel: m.small, decisionModel: m.decision, maxTokens: 1500, thinkingBudget: null, contextProfile: 'full' },
    max: { screeningModel: null, decisionModel: m.top, maxTokens: 8192, thinkingBudget: 4096, contextProfile: 'full' },
  };
  const key = AI_MODE_NAMES.includes(name) ? name : 'balanced';
  return { name: key, ...modes[key] };
}

module.exports = { resolveAiMode, AI_MODE_NAMES };
