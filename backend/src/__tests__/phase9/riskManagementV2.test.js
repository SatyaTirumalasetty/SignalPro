const {
  DEFAULT_AUTHORITY, checkAuthority, validateStopAdjustment, partialExitQuantity,
} = require('../../services/riskManagement');

describe('checkAuthority', () => {
  test('defaults: close allowed, others denied', () => {
    expect(checkAuthority(DEFAULT_AUTHORITY, 'close')).toBe(true);
    expect(checkAuthority(DEFAULT_AUTHORITY, 'adjust_stop')).toBe(false);
    expect(checkAuthority(DEFAULT_AUTHORITY, 'partial_exit')).toBe(false);
    expect(checkAuthority(DEFAULT_AUTHORITY, 'add')).toBe(false);
  });

  test('entries and hold are not governed by authority toggles', () => {
    expect(checkAuthority(DEFAULT_AUTHORITY, 'open_long')).toBe(true);
    expect(checkAuthority(DEFAULT_AUTHORITY, 'hold')).toBe(true);
  });

  test('user-enabled toggle allows the action', () => {
    expect(checkAuthority({ ...DEFAULT_AUTHORITY, adjust_stop: true }, 'adjust_stop')).toBe(true);
  });

  test('null authority falls back to defaults', () => {
    expect(checkAuthority(null, 'close')).toBe(true);
    expect(checkAuthority(null, 'adjust_stop')).toBe(false);
  });
});

describe('validateStopAdjustment', () => {
  test('long: only a higher stop is a tighten', () => {
    expect(validateStopAdjustment({ positionType: 'long', currentStop: 95, newStop: 97 })).toBe(true);
    expect(validateStopAdjustment({ positionType: 'long', currentStop: 95, newStop: 93 })).toBe(false);
    expect(validateStopAdjustment({ positionType: 'long', currentStop: 95, newStop: 95 })).toBe(false);
  });

  test('short: only a lower stop is a tighten', () => {
    expect(validateStopAdjustment({ positionType: 'short', currentStop: 105, newStop: 103 })).toBe(true);
    expect(validateStopAdjustment({ positionType: 'short', currentStop: 105, newStop: 107 })).toBe(false);
  });

  test('no current stop: setting one is allowed', () => {
    expect(validateStopAdjustment({ positionType: 'long', currentStop: null, newStop: 90 })).toBe(true);
  });

  test('invalid newStop rejected', () => {
    expect(validateStopAdjustment({ positionType: 'long', currentStop: 95, newStop: 0 })).toBe(false);
    expect(validateStopAdjustment({ positionType: 'long', currentStop: 95, newStop: null })).toBe(false);
  });
});

describe('partialExitQuantity', () => {
  test('floors to whole shares', () => {
    expect(partialExitQuantity({ positionQty: 10, exitFraction: 0.5 })).toBe(5);
    expect(partialExitQuantity({ positionQty: 7, exitFraction: 0.5 })).toBe(3);
  });

  test('returns 0 for invalid inputs or fractions outside (0,1)', () => {
    expect(partialExitQuantity({ positionQty: 1, exitFraction: 0.5 })).toBe(0);
    expect(partialExitQuantity({ positionQty: 10, exitFraction: 0 })).toBe(0);
    expect(partialExitQuantity({ positionQty: 10, exitFraction: 1 })).toBe(0);
    expect(partialExitQuantity({ positionQty: 0, exitFraction: 0.5 })).toBe(0);
  });
});
