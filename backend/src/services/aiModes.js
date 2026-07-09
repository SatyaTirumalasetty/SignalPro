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
    minimize: { screeningModel: null, decisionModel: m.small, maxTokens: 1024, effort: null, contextProfile: 'trimmed' },
    balanced: { screeningModel: null, decisionModel: m.decision, maxTokens: 1500, effort: null, contextProfile: 'full' },
    tiered: { screeningModel: m.small, decisionModel: m.decision, maxTokens: 1500, effort: null, contextProfile: 'full' },
    // Adaptive thinking spends from max_tokens, so max mode gets headroom.
    max: { screeningModel: null, decisionModel: m.top, maxTokens: 16000, effort: 'xhigh', contextProfile: 'full' },
  };
  const key = AI_MODE_NAMES.includes(name) ? name : 'balanced';
  return { name: key, ...modes[key] };
}

module.exports = { resolveAiMode, AI_MODE_NAMES };
