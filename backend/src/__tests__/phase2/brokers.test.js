process.env.JWT_SECRET = 'test-jwt-secret-minimum-64-chars-for-testing-only-pad-here!!';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-minimum-64-chars-for-tests-pad-here!!';
process.env.ENCRYPTION_KEY = 'test_key_32_bytes_padding_here!!';
process.env.API_BASE_URL = 'http://localhost:3001';
process.env.FRONTEND_URL = 'http://localhost:5173';

const mockDb = {
  one: jest.fn(),
  oneOrNone: jest.fn(),
  none: jest.fn(),
  manyOrNone: jest.fn(),
  result: jest.fn(),
  tx: jest.fn(async (fn) => fn({ none: jest.fn().mockResolvedValue(undefined), one: jest.fn() })),
};

jest.mock('../../config/database', () => ({ db: mockDb, initializeDatabase: jest.fn() }));
jest.mock('../../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../services/brokerSync', () => ({
  syncConnection: jest.fn().mockResolvedValue({ account_id: 'acc123' }),
  startCronJobs: jest.fn(),
}));
jest.mock('axios', () => {
  const mockInstance = { get: jest.fn(), post: jest.fn() };
  const axios = jest.fn(() => mockInstance);
  axios.create = jest.fn(() => mockInstance);
  axios._mockInstance = mockInstance;
  return axios;
});

const express = require('express');
const request = require('supertest');
const brokersRouter = require('../../routes/brokers');
const { generateAccessToken } = require('../../middleware/auth');
const { encryptCredentials } = require('../../config/brokerEncryption');

const app = express();
app.use(express.json());
app.use('/api/brokers', brokersRouter);
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));

const testUser = { id: 'user-uuid-1', email: 'test@signalpro.com', role: 'user', status: 'active' };
let authHeader;
beforeAll(() => { authHeader = `Bearer ${generateAccessToken(testUser)}`; });

beforeEach(() => {
  jest.resetAllMocks();
  // Restore defaults after reset
  mockDb.none.mockResolvedValue(undefined);
  mockDb.tx.mockImplementation(async (fn) => fn({ none: jest.fn().mockResolvedValue(undefined), one: jest.fn() }));
  const { syncConnection } = require('../../services/brokerSync');
  syncConnection.mockResolvedValue({ account_id: 'acc123' });
});

const encryptedCreds = encryptCredentials({ api_key: 'test_key', api_secret: 'test_secret' });
const alpacaConnection = {
  id: 'conn-1', user_id: testUser.id, broker_id: 'alpaca', name: 'My Alpaca',
  status: 'connected', credentials_encrypted: encryptedCreds,
  account_info: JSON.stringify({ balance: 10000 }), token_expires_at: null,
};

// ── GET /supported (broker list) ──────────────────────────────────────────────

describe('GET /api/brokers/supported', () => {
  test('200: returns supported broker list', async () => {
    const res = await request(app).get('/api/brokers/supported');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.brokers)).toBe(true);
    expect(res.body.brokers.length).toBe(7);
    const ids = res.body.brokers.map(b => b.id);
    expect(ids).toContain('alpaca');
    expect(ids).toContain('zerodha');
  });
});

// ── GET /connections ──────────────────────────────────────────────────────────

describe('GET /api/brokers/connections', () => {
  test('200: returns user connections without credentials', async () => {
    const { credentials_encrypted, ...safeConn } = alpacaConnection;
    mockDb.manyOrNone.mockResolvedValueOnce([safeConn]);

    const res = await request(app).get('/api/brokers/connections').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.connections)).toBe(true);
    expect(res.body.connections[0].credentials_encrypted).toBeUndefined();
  });

  test('401: unauthenticated', async () => {
    const res = await request(app).get('/api/brokers/connections');
    expect(res.status).toBe(401);
  });
});

// ── POST /connect ─────────────────────────────────────────────────────────────

describe('POST /api/brokers/connect', () => {
  test('400: missing broker_id', async () => {
    const res = await request(app).post('/api/brokers/connect')
      .set('Authorization', authHeader)
      .send({ name: 'Test', credentials: {} });
    expect(res.status).toBe(400);
  });

  test('400: unknown broker_id', async () => {
    const res = await request(app).post('/api/brokers/connect')
      .set('Authorization', authHeader)
      .send({ broker_id: 'nonexistent_broker', name: 'Test', credentials: { api_key: 'k' } });
    expect(res.status).toBe(400);
  });

  test('400: OAuth-only broker (zerodha) rejects direct connect', async () => {
    const res = await request(app).post('/api/brokers/connect')
      .set('Authorization', authHeader)
      .send({ broker_id: 'zerodha', name: 'T', credentials: { api_key: 'k', api_secret: 's', access_token: 't' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/oauth/i);
  });

  test('401: unauthenticated', async () => {
    const res = await request(app).post('/api/brokers/connect')
      .send({ broker_id: 'alpaca', name: 'T', credentials: {} });
    expect(res.status).toBe(401);
  });
});

// ── DELETE /connections/:id ───────────────────────────────────────────────────

describe('DELETE /api/brokers/connections/:id', () => {
  test('200: disconnects owned connection', async () => {
    mockDb.result.mockResolvedValueOnce({ rowCount: 1 });
    const res = await request(app).delete('/api/brokers/connections/conn-1').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/disconnect/i);
  });

  test('404: connection not found', async () => {
    mockDb.result.mockResolvedValueOnce({ rowCount: 0 });
    const res = await request(app).delete('/api/brokers/connections/bad-id').set('Authorization', authHeader);
    expect(res.status).toBe(404);
  });
});

// ── POST /connections/:id/sync ────────────────────────────────────────────────

describe('POST /api/brokers/connections/:id/sync', () => {
  test('200: triggers async sync and returns acknowledgement', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce({ id: 'conn-1' }); // ownership check
    const res = await request(app).post('/api/brokers/connections/conn-1/sync').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/sync/i);
  });

  test('404: connection not found or not active', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    const res = await request(app).post('/api/brokers/connections/bad/sync').set('Authorization', authHeader);
    expect(res.status).toBe(404);
  });
});

// ── GET /:brokerId/oauth/url ──────────────────────────────────────────────────

describe('GET /api/brokers/:brokerId/oauth/url', () => {
  test('200: returns OAuth URL for zerodha with api_key', async () => {
    const res = await request(app).get('/api/brokers/zerodha/oauth/url')
      .set('Authorization', authHeader)
      .query({ api_key: 'test_api_key', api_secret: 'test_api_secret' });
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('kite.zerodha.com');
    expect(res.body.state).toBeDefined();
  });

  test('400: missing api_key for zerodha', async () => {
    const res = await request(app).get('/api/brokers/zerodha/oauth/url')
      .set('Authorization', authHeader);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/api_key/i);
  });

  test('400: non-OAuth broker (alpaca) returns error', async () => {
    const res = await request(app).get('/api/brokers/alpaca/oauth/url')
      .set('Authorization', authHeader);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/oauth/i);
  });

  test('401: unauthenticated', async () => {
    const res = await request(app).get('/api/brokers/zerodha/oauth/url');
    expect(res.status).toBe(401);
  });
});
