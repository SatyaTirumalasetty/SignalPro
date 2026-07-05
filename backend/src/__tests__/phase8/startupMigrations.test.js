const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

// server.js runs start() on require; mock every module with side effects so
// requiring it is cheap, and listen on an ephemeral port.
function loadServer() {
  jest.doMock('../../config/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
  jest.doMock('../../config/database', () => ({
    db: {},
    pgp: {},
    initializeDatabase: jest.fn().mockResolvedValue(true),
  }));
  jest.doMock('../../services/brokerSync', () => ({ startCronJobs: jest.fn() }));
  jest.doMock('../../services/autoTradingEngine', () => ({ startAutoTradingCron: jest.fn() }));
  jest.doMock('../../services/alpacaMarketData', () => ({
    isConfigured: () => false,
    getLatestQuotes: jest.fn(),
  }));
  jest.doMock('../../database/migrate', () => ({
    runMigrations: jest.fn().mockResolvedValue(undefined),
  }));
  const { runMigrations } = require('../../database/migrate');
  const { startCronJobs } = require('../../services/brokerSync');
  const { server } = require('../../server');
  return { runMigrations, startCronJobs, server };
}

describe('startup migrations gate', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.PORT = '0';
  });
  afterEach(() => {
    delete process.env.RUN_MIGRATIONS_ON_START;
    delete process.env.PORT;
  });

  test('does not run migrations when RUN_MIGRATIONS_ON_START is unset', async () => {
    delete process.env.RUN_MIGRATIONS_ON_START;
    const { runMigrations, startCronJobs, server } = loadServer();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(runMigrations).not.toHaveBeenCalled();
    expect(startCronJobs).toHaveBeenCalled(); // startup still proceeds
    server.close();
  });

  test('runs migrations before starting cron jobs when flag is true', async () => {
    process.env.RUN_MIGRATIONS_ON_START = 'true';
    const { runMigrations, startCronJobs, server } = loadServer();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(runMigrations).toHaveBeenCalledTimes(1);
    expect(startCronJobs).toHaveBeenCalled();
    expect(runMigrations.mock.invocationCallOrder[0])
      .toBeLessThan(startCronJobs.mock.invocationCallOrder[0]);
    server.close();
  });
});
