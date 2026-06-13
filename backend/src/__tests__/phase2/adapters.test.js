process.env.ENCRYPTION_KEY = 'test_key_32_bytes_padding_here!!';

jest.mock('axios', () => {
  const mockInstance = {
    get: jest.fn(),
    post: jest.fn(),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  const axios = jest.fn(() => mockInstance);
  axios.create = jest.fn(() => mockInstance);
  axios.get = jest.fn();
  axios.post = jest.fn();
  axios._mockInstance = mockInstance;
  return axios;
});
jest.mock('../../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const axios = require('axios');
const mockAxios = axios._mockInstance;

beforeEach(() => jest.clearAllMocks());

// ── BaseAdapter ───────────────────────────────────────────────────────────────

describe('BaseAdapter', () => {
  const BaseAdapter = require('../../services/brokers/adapters/base');

  test('constructor stores brokerId and credentials', () => {
    const adapter = new BaseAdapter('alpaca', { api_key: 'k', api_secret: 's' });
    expect(adapter.brokerId).toBe('alpaca');
    expect(adapter.credentials).toEqual({ api_key: 'k', api_secret: 's' });
  });

  test('requireFields throws if field missing', () => {
    const adapter = new BaseAdapter('test', { api_key: 'k' });
    expect(() => adapter.requireFields('api_key', 'api_secret')).toThrow(/api_secret/i);
  });

  test('requireFields passes when all fields present', () => {
    const adapter = new BaseAdapter('test', { api_key: 'k', api_secret: 's' });
    expect(() => adapter.requireFields('api_key', 'api_secret')).not.toThrow();
  });

  test('credentialError returns structured error', () => {
    const adapter = new BaseAdapter('test', {});
    const err = adapter.credentialError('api_key');
    expect(err.status).toBe(400);
    expect(err.message).toMatch(/api_key/);
  });

  test('apiError returns structured error with custom status', () => {
    const adapter = new BaseAdapter('test', {});
    const err = adapter.apiError('Rate limited', 429);
    expect(err.status).toBe(429);
    expect(err.message).toMatch(/Rate limited/);
  });

  test('base validateCredentials throws NotImplemented', async () => {
    const adapter = new BaseAdapter('test', {});
    await expect(adapter.validateCredentials()).rejects.toThrow();
  });
});

// ── Alpaca Adapter ────────────────────────────────────────────────────────────

describe('AlpacaAdapter', () => {
  const AlpacaAdapter = require('../../services/brokers/adapters/alpaca');
  const creds = { api_key: 'APCA_TEST', api_secret: 'SECRET', paper_trading: false };

  test('validateCredentials succeeds with valid account response', async () => {
    mockAxios.get.mockResolvedValueOnce({
      data: { id: 'acc-1', equity: '50000', cash: '10000', status: 'ACTIVE', account_number: 'AN123' },
    });
    const adapter = new AlpacaAdapter(creds);
    const result = await adapter.validateCredentials();
    expect(result).toBeDefined();
    expect(result.valid).toBe(true);
    expect(result.broker_user_id).toBe('acc-1');
  });

  test('validateCredentials throws on 401', async () => {
    const err = new Error('Unauthorized');
    err.response = { status: 401, data: { message: 'Invalid API key' } };
    mockAxios.get.mockRejectedValueOnce(err);
    const adapter = new AlpacaAdapter(creds);
    await expect(adapter.validateCredentials()).rejects.toThrow();
  });

  test('getAccountInfo returns normalized account object', async () => {
    mockAxios.get.mockResolvedValueOnce({
      data: { id: 'acc-1', equity: '50000', cash: '10000', buying_power: '100000', status: 'ACTIVE', currency: 'USD' },
    });
    const adapter = new AlpacaAdapter(creds);
    const result = await adapter.getAccountInfo();
    expect(result.account_id || result.balance || result.equity).toBeDefined();
  });

  test('getPositions returns array', async () => {
    mockAxios.get.mockResolvedValueOnce({ data: [
      { symbol: 'AAPL', qty: '10', avg_entry_price: '150.00', market_value: '1600.00', unrealized_pl: '100.00', side: 'long' }
    ] });
    const adapter = new AlpacaAdapter(creds);
    const result = await adapter.getPositions();
    expect(Array.isArray(result)).toBe(true);
  });

  test('getOrders returns array', async () => {
    mockAxios.get.mockResolvedValueOnce({ data: [
      { id: 'ord-1', symbol: 'TSLA', qty: '5', side: 'buy', type: 'market', status: 'filled', filled_at: new Date().toISOString() }
    ] });
    const adapter = new AlpacaAdapter(creds);
    const result = await adapter.getOrders(10);
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── Zerodha Adapter ───────────────────────────────────────────────────────────

describe('ZerodhaAdapter', () => {
  const ZerodhaAdapter = require('../../services/brokers/adapters/zerodha');

  test('requireFields validates api_key, api_secret, access_token', () => {
    const adapter = new ZerodhaAdapter({});
    expect(() => adapter.requireFields('api_key', 'api_secret', 'access_token')).toThrow();
  });

  test('getOAuthUrl returns kite.zerodha.com URL', () => {
    const url = ZerodhaAdapter.getOAuthUrl('test_api_key');
    expect(url).toContain('kite.zerodha.com');
    expect(url).toContain('test_api_key');
  });

  test('validateCredentials with access_token makes profile call', async () => {
    mockAxios.get.mockResolvedValueOnce({
      data: { status: 'success', data: { user_id: 'ZU1234', user_name: 'Test', email: 'test@test.com' } },
    });
    const creds = { api_key: 'k', api_secret: 's', access_token: 'tok' };
    const adapter = new ZerodhaAdapter(creds);
    const result = await adapter.validateCredentials();
    expect(result).toBeDefined();
  });
});

// ── Interactive Brokers Adapter ───────────────────────────────────────────────

describe('InteractiveBrokersAdapter', () => {
  const InteractiveBrokersAdapter = require('../../services/brokers/adapters/interactiveBrokers');

  test('defaults to the IBKR cloud gateway when gateway_url is not provided', () => {
    const adapter = new InteractiveBrokersAdapter({ access_token: 'tok', account_id: 'U123' });
    expect(adapter.accountId).toBe('U123');
    expect(axios.create).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'https://api.ibkr.com/v1/api' }));
  });

  test('accepts a local self-hosted gateway URL', () => {
    new InteractiveBrokersAdapter({ access_token: 'tok', account_id: 'U123', gateway_url: 'https://localhost:5000/v1/api' });
    expect(axios.create).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'https://localhost:5000/v1/api' }));
  });

  test('rejects an arbitrary gateway_url (SSRF prevention)', () => {
    expect(() => new InteractiveBrokersAdapter({
      access_token: 'tok', account_id: 'U123', gateway_url: 'https://evil.example.com/v1/api',
    })).toThrow(/Invalid gateway_url/);
  });

  test('validateCredentials returns valid when authenticated', async () => {
    mockAxios.get.mockResolvedValueOnce({ data: { authenticated: true } });
    const adapter = new InteractiveBrokersAdapter({ access_token: 'tok', account_id: 'U123' });
    const result = await adapter.validateCredentials();
    expect(result.valid).toBe(true);
  });
});

// ── Coinbase Adapter ──────────────────────────────────────────────────────────

describe('CoinbaseAdapter', () => {
  const CoinbaseAdapter = require('../../services/brokers/adapters/coinbase');

  test('legacy auth: validates with api_key + api_secret + passphrase', async () => {
    mockAxios.get.mockResolvedValueOnce({
      data: [{ uuid: 'acc-1', currency: 'USD', available_balance: { value: '5000', currency: 'USD' } }],
    });
    const creds = { api_key: 'CB_API_KEY', api_secret: 'CB_SECRET', passphrase: 'CB_PASS' };
    const adapter = new CoinbaseAdapter(creds);
    const result = await adapter.validateCredentials();
    expect(result).toBeDefined();
  });

  test('throws if no credentials provided', () => {
    const adapter = new CoinbaseAdapter({});
    expect(() => adapter.requireFields('api_key')).toThrow();
  });
});

// ── BrokerRegistry ────────────────────────────────────────────────────────────

describe('BrokerRegistry (services/brokers/index)', () => {
  const { listBrokers, getBrokerMeta, isOAuthBroker } = require('../../services/brokers/index');

  test('listBrokers returns all 7 brokers', () => {
    const brokers = listBrokers();
    expect(brokers.length).toBe(7);
  });

  test('getBrokerMeta returns correct metadata', () => {
    const meta = getBrokerMeta('alpaca');
    expect(meta.id).toBe('alpaca');
    expect(meta.name).toBeDefined();
  });

  test('getBrokerMeta returns null for unknown broker', () => {
    const result = getBrokerMeta('nonexistent');
    expect(result).toBeNull();
  });

  test('isOAuthBroker returns true for zerodha', () => {
    expect(isOAuthBroker('zerodha')).toBe(true);
  });

  test('isOAuthBroker returns false for alpaca', () => {
    expect(isOAuthBroker('alpaca')).toBe(false);
  });

  test('all brokers have required fields (id, name, auth_type, credential_fields)', () => {
    for (const broker of listBrokers()) {
      expect(broker.id).toBeDefined();
      expect(broker.name).toBeDefined();
      expect(broker.auth_type).toBeDefined();
      expect(Array.isArray(broker.credential_fields)).toBe(true);
    }
  });
});
