// Validates the structured decision JSON returned by Claude before the
// engine acts on it. Never guess a trade from a malformed response.

const VALID_ACTIONS = ['open_long', 'open_short', 'close', 'adjust_stop', 'partial_exit', 'add', 'hold'];
const ENTRY_ACTIONS = ['open_long', 'open_short', 'add'];
const POSITION_ACTIONS = ['close', 'adjust_stop', 'partial_exit', 'add'];

const NUMERIC_FIELDS = ['entry_price', 'stop_loss', 'take_profit', 'exit_fraction', 'risk_reward'];

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function validateDecision(raw, { hasPosition }) {
  const errors = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['decision is not an object'] };

  if (!VALID_ACTIONS.includes(raw.action)) errors.push(`invalid action: ${raw.action}`);

  if (POSITION_ACTIONS.includes(raw.action) && !hasPosition) {
    errors.push(`${raw.action} requires an open position`);
  }

  const decision = {
    action: raw.action,
    confidence: Math.min(100, Math.max(0, Math.round(Number(raw.confidence) || 0))),
    reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : '',
    timeframe_alignment: raw.timeframe_alignment && typeof raw.timeframe_alignment === 'object'
      ? raw.timeframe_alignment : {},
    invalidation: typeof raw.invalidation === 'string' ? raw.invalidation : null,
  };
  for (const f of NUMERIC_FIELDS) decision[f] = num(raw[f]);

  if (['open_long', 'open_short', 'add'].includes(raw.action) && decision.stop_loss === null) {
    errors.push(`${raw.action} requires stop_loss`);
  }
  if (raw.action === 'adjust_stop' && decision.stop_loss === null) {
    errors.push('adjust_stop requires stop_loss');
  }
  if (raw.action === 'partial_exit'
      && (decision.exit_fraction === null || decision.exit_fraction <= 0 || decision.exit_fraction >= 1)) {
    errors.push('partial_exit requires exit_fraction strictly between 0 and 1');
  }

  return errors.length ? { ok: false, errors } : { ok: true, decision };
}

module.exports = { VALID_ACTIONS, ENTRY_ACTIONS, POSITION_ACTIONS, validateDecision };
