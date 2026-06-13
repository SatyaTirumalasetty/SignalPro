process.env.JWT_SECRET = 'test-jwt-secret-minimum-64-chars-for-testing-only-pad-here!!';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-minimum-64-chars-for-tests-pad-here!!';
process.env.ENCRYPTION_KEY = 'test_key_32_bytes_padding_here!!';

const mockDb = {
  one: jest.fn(),
  oneOrNone: jest.fn(),
  none: jest.fn(),
  manyOrNone: jest.fn(),
  result: jest.fn(),
  tx: jest.fn(async (fn) => fn({
    none: jest.fn().mockResolvedValue(undefined),
    one: jest.fn().mockResolvedValue({ id: 'ak-new', name: 'Rotated Key', key_hash: 'hash' }),
    result: jest.fn().mockResolvedValue({ rowCount: 1 }),
  })),
};

jest.mock('../../config/database', () => ({ db: mockDb, initializeDatabase: jest.fn() }));
jest.mock('../../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const express = require('express');
const request = require('supertest');
const apiKeysRouter = require('../../routes/apiKeys');
const { generateAccessToken } = require('../../middleware/auth');

const app = express();
app.use(express.json());
app.use('/api/api-keys', apiKeysRouter);
app.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

const testUser = { id: 'user-uuid-1', email: 'test@signalpro.com', role: 'user', status: 'active' };
let authHeader;
beforeAll(() => { authHeader = `Bearer ${generateAccessToken(testUser)}`; });
beforeEach(() => jest.clearAllMocks());

const sampleKey = { id: 'ak-1', user_id: testUser.id, name: 'My Key', key_prefix: 'sp_live_', last_used_at: null, created_at: new Date().toISOString() };

// ── GET / ─────────────────────────────────────────────────────────────────────

describe('GET /api/api-keys', () => {
  test('200: returns list of API keys', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce([sampleKey]);
    const res = await request(app).get('/api/api-keys').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.api_keys)).toBe(true);
    expect(res.body.api_keys[0].id).toBe('ak-1');
    // raw key hash must never be returned
    expect(res.body.api_keys[0].key_hash).toBeUndefined();
  });

  test('401: unauthenticated', async () => {
    const res = await request(app).get('/api/api-keys');
    expect(res.status).toBe(401);
  });
});

// ── POST / ────────────────────────────────────────────────────────────────────

describe('POST /api/api-keys', () => {
  test('201: creates key and returns raw key once', async () => {
    mockDb.one.mockResolvedValueOnce({ count: '2' }); // count check
    mockDb.none.mockResolvedValueOnce(undefined);     // INSERT

    const res = await request(app).post('/api/api-keys')
      .set('Authorization', authHeader)
      .send({ name: 'My Key' });
    expect(res.status).toBe(201);
    // key is returned inside api_key.key, not at top-level raw_key
    expect(res.body.api_key.key).toMatch(/^sp_live_/);
    expect(res.body.warning).toBeDefined();
  });

  test('400: missing name', async () => {
    const res = await request(app).post('/api/api-keys')
      .set('Authorization', authHeader)
      .send({});
    expect(res.status).toBe(400);
  });

  test('400: max 10 keys reached (returns 400 not 403)', async () => {
    mockDb.one.mockResolvedValueOnce({ count: '10' });
    const res = await request(app).post('/api/api-keys')
      .set('Authorization', authHeader)
      .send({ name: 'Overflow Key' });
    expect(res.status).toBe(400);
  });
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────

describe('DELETE /api/api-keys/:id', () => {
  test('200: revokes owned key', async () => {
    mockDb.result.mockResolvedValueOnce({ rowCount: 1 });
    const res = await request(app).delete('/api/api-keys/ak-1').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/revoked/i);
  });

  test('404: key not found or not owned', async () => {
    mockDb.result.mockResolvedValueOnce({ rowCount: 0 });
    const res = await request(app).delete('/api/api-keys/bad-key').set('Authorization', authHeader);
    expect(res.status).toBe(404);
  });
});

// ── POST /:id/rotate ──────────────────────────────────────────────────────────

describe('POST /api/api-keys/:id/rotate', () => {
  test('200: rotates key atomically and returns new raw key', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(sampleKey); // ownership check
    // tx mock is defined in mockDb.tx (uses t.none for two INSERTs)

    const res = await request(app).post('/api/api-keys/ak-1/rotate').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    // key is returned inside api_key.key
    expect(res.body.api_key.key).toMatch(/^sp_live_/);
    expect(res.body.warning).toBeDefined();
  });

  test('404: key not found', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    const res = await request(app).post('/api/api-keys/bad-id/rotate').set('Authorization', authHeader);
    expect(res.status).toBe(404);
  });
});
