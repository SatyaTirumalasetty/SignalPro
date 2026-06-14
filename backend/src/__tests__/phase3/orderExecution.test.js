const mockDb = { none: jest.fn() };
const mockDecryptCredentials = jest.fn();
const mockGetAdapter = jest.fn();

jest.mock('../../config/database', () => ({ db: mockDb }));
jest.mock('../../config/brokerEncryption', () => ({ decryptCredentials: mockDecryptCredentials }));
jest.mock('../../services/brokers/index', () => ({ getAdapter: mockGetAdapter }));

const { executeOrderAsync } = require('../../services/orderExecution');

beforeEach(() => {
  jest.resetAllMocks();
  mockDb.none.mockResolvedValue(undefined);
});

describe('executeOrderAsync', () => {
  it('marks the order as rejected when the broker adapter throws', async () => {
    mockDecryptCredentials.mockReturnValue({ api_key: 'key', secret: 'secret' });
    mockGetAdapter.mockReturnValue({
      placeOrder: jest.fn().mockRejectedValue(new Error('Broker unavailable')),
    });

    await executeOrderAsync('order-1', { broker_id: 'alpaca', credentials_encrypted: 'enc' }, 'AAPL', 'buy', 'market', 10);

    expect(mockDb.none).toHaveBeenCalledWith(
      expect.stringContaining("status = 'rejected'"),
      ['Broker unavailable', 'order-1'],
    );
  });
});
