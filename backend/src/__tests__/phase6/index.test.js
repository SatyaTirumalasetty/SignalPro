const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

describe('src/index.js bootstrap', () => {
  test('starts the server after secrets load successfully', async () => {
    jest.doMock('dotenv', () => ({ config: jest.fn() }));
    jest.doMock('../../server', () => ({}));
    jest.doMock('../../config/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
    jest.doMock('../../config/secrets', () => ({
      loadSecrets: jest.fn().mockResolvedValue(undefined),
    }));

    const logger = require('../../config/logger');
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    require('../../index');
    await flushMicrotasks();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();

    exitSpy.mockRestore();
  });

  test('logs and exits when secrets fail to load', async () => {
    jest.doMock('dotenv', () => ({ config: jest.fn() }));
    jest.doMock('../../server', () => ({}));
    jest.doMock('../../config/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
    jest.doMock('../../config/secrets', () => ({
      loadSecrets: jest.fn().mockRejectedValue(new Error('access denied')),
    }));

    const logger = require('../../config/logger');
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    require('../../index');
    await flushMicrotasks();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: 'access denied' }),
      expect.any(String)
    );
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});
