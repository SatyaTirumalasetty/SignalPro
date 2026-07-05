const path = require('path');

const executed = [];
const t = { none: jest.fn((sql, params) => { executed.push({ sql, params }); return Promise.resolve(); }) };
const mockDb = {
  none: jest.fn(() => Promise.resolve()),
  oneOrNone: jest.fn(),
  manyOrNone: jest.fn(),
  tx: jest.fn((fn) => fn(t)),
};

jest.mock('../../config/database', () => ({ db: mockDb }));
jest.mock('../../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const { runMigrations } = require('../../database/migrate');

beforeEach(() => {
  executed.length = 0;
  jest.clearAllMocks();
});

describe('runMigrations', () => {
  test('fresh database: applies init.sql then every migration file in order', async () => {
    mockDb.manyOrNone.mockResolvedValue([]); // empty ledger
    mockDb.oneOrNone.mockResolvedValue({ reg: null }); // users table absent

    await runMigrations();

    // First tx applies init.sql and records 000_init
    const recorded = executed
      .filter((e) => /INSERT INTO schema_migrations/.test(e.sql))
      .map((e) => e.params[0]);
    expect(recorded[0]).toBe('000_init');
    expect(recorded).toContain('001_phase1_additions.sql');
    expect(recorded).toContain('20260614000000_add_auto_trading.sql');
    // Order: 001... before 2026...
    expect(recorded.indexOf('001_phase1_additions.sql'))
      .toBeLessThan(recorded.indexOf('20260613000000_add_order_sl_tp_columns.sql'));
  });

  test('existing hand-managed database: baselines ledger without executing SQL files', async () => {
    mockDb.manyOrNone.mockResolvedValue([]); // empty ledger
    mockDb.oneOrNone.mockResolvedValue({ reg: 'users' }); // users table exists

    await runMigrations();

    const inserts = executed.filter((e) => /INSERT INTO schema_migrations/.test(e.sql));
    const nonInserts = executed.filter((e) => !/INSERT INTO schema_migrations/.test(e.sql));
    expect(inserts.length).toBeGreaterThanOrEqual(8); // 000_init + 7 files
    expect(nonInserts).toHaveLength(0); // no migration SQL actually ran
  });

  test('already-applied migrations are skipped', async () => {
    mockDb.manyOrNone.mockResolvedValue([
      { version: '000_init' },
      { version: '001_phase1_additions.sql' },
      { version: '002_phase2_additions.sql' },
      { version: '003_users_role_column.sql' },
      { version: '004_support_ticket_assigned_to_fk.sql' },
      { version: '005_orders_risk_columns.sql' },
      { version: '20260613000000_add_order_sl_tp_columns.sql' },
      { version: '20260614000000_add_auto_trading.sql' },
    ]);
    mockDb.oneOrNone.mockResolvedValue({ reg: 'users' });

    await runMigrations();

    expect(mockDb.tx).not.toHaveBeenCalled();
  });
});
