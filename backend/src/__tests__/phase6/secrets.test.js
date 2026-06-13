jest.mock('../../config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  GetSecretValueCommand: jest.fn().mockImplementation((input) => input),
}));

const logger = require('../../config/logger');
const { loadSecrets } = require('../../config/secrets');

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.AWS_SECRETS_MANAGER_SECRET_ID;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('loadSecrets()', () => {
  test('is a no-op when AWS_SECRETS_MANAGER_SECRET_ID is unset', async () => {
    await loadSecrets();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('merges secret values into process.env', async () => {
    process.env.AWS_SECRETS_MANAGER_SECRET_ID = 'signalpro/prod';
    delete process.env.SOME_NEW_SECRET;
    mockSend.mockResolvedValueOnce({
      SecretString: JSON.stringify({ SOME_NEW_SECRET: 'value-from-aws', ANTHROPIC_API_KEY: 'aws-key' }),
    });

    await loadSecrets();

    expect(process.env.SOME_NEW_SECRET).toBe('value-from-aws');
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ secretId: 'signalpro/prod', keysFound: 2, applied: 2 }),
      expect.any(String)
    );
  });

  test('does not overwrite values already set in process.env', async () => {
    process.env.AWS_SECRETS_MANAGER_SECRET_ID = 'signalpro/prod';
    process.env.ANTHROPIC_API_KEY = 'existing-key';
    mockSend.mockResolvedValueOnce({
      SecretString: JSON.stringify({ ANTHROPIC_API_KEY: 'aws-key' }),
    });

    await loadSecrets();

    expect(process.env.ANTHROPIC_API_KEY).toBe('existing-key');
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ applied: 0 }),
      expect.any(String)
    );
  });

  test('throws and logs when the AWS request fails', async () => {
    process.env.AWS_SECRETS_MANAGER_SECRET_ID = 'signalpro/prod';
    mockSend.mockRejectedValueOnce(new Error('access denied'));

    await expect(loadSecrets()).rejects.toThrow('access denied');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: 'access denied', secretId: 'signalpro/prod' }),
      expect.any(String)
    );
  });
});
