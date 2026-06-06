process.env.JWT_SECRET = 'test-jwt-secret-minimum-64-chars-for-testing-only-pad-here!!';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-minimum-64-chars-for-tests-pad-here!!';
process.env.ENCRYPTION_KEY = 'test_key_32_bytes_padding_here!!';

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

const express = require('express');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const usersRouter = require('../../routes/users');
const { generateAccessToken } = require('../../middleware/auth');

const app = express();
app.use(express.json());
app.use('/api/users', usersRouter);
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));

const TEST_PASSWORD = 'Password123!';
const TEST_HASH = bcrypt.hashSync(TEST_PASSWORD, 1);
const testUser = { id: 'user-uuid-1', email: 'test@signalpro.com', role: 'user', status: 'active' };

let authHeader;
beforeAll(() => {
  authHeader = `Bearer ${generateAccessToken(testUser)}`;
});
beforeEach(() => jest.clearAllMocks());

// ── GET /me ───────────────────────────────────────────────────────────────────

describe('GET /api/users/me', () => {
  test('200: returns full user profile from DB', async () => {
    const dbUser = { ...testUser, full_name: 'Test User', phone: null, country: null, email_verified: true, subscription_tier: 'free', preferences: {} };
    mockDb.oneOrNone.mockResolvedValueOnce(dbUser);

    const res = await request(app).get('/api/users/me').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(testUser.email);
    expect(res.body.user.full_name).toBe('Test User');
    expect(res.body.user.password_hash).toBeUndefined();
  });

  test('401: no token', async () => {
    const res = await request(app).get('/api/users/me');
    expect(res.status).toBe(401);
  });

  test('404: user not found in DB', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    const res = await request(app).get('/api/users/me').set('Authorization', authHeader);
    expect(res.status).toBe(404);
  });
});

// ── PUT /me ───────────────────────────────────────────────────────────────────

describe('PUT /api/users/me', () => {
  test('200: updates name and phone', async () => {
    const updated = { ...testUser, full_name: 'New Name', phone: '+1234567890' };
    mockDb.oneOrNone.mockResolvedValueOnce(updated);

    const res = await request(app).put('/api/users/me')
      .set('Authorization', authHeader)
      .send({ full_name: 'New Name', phone: '+1234567890' });
    expect(res.status).toBe(200);
    expect(res.body.user.full_name).toBe('New Name');
  });

  test('400: empty full_name', async () => {
    const res = await request(app).put('/api/users/me')
      .set('Authorization', authHeader)
      .send({ full_name: '' });
    expect(res.status).toBe(400);
  });

  test('401: unauthenticated', async () => {
    const res = await request(app).put('/api/users/me').send({ full_name: 'Test' });
    expect(res.status).toBe(401);
  });
});

// ── PUT /me/password ──────────────────────────────────────────────────────────

describe('PUT /api/users/me/password', () => {
  test('200: valid current password changes password', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce({ ...testUser, password_hash: TEST_HASH });
    mockDb.none.mockResolvedValueOnce(undefined);

    const res = await request(app).put('/api/users/me/password')
      .set('Authorization', authHeader)
      .send({ current_password: TEST_PASSWORD, new_password: 'NewPassword456!' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();
  });

  test('401: wrong current password', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce({ ...testUser, password_hash: TEST_HASH });

    const res = await request(app).put('/api/users/me/password')
      .set('Authorization', authHeader)
      .send({ current_password: 'WrongPassword!', new_password: 'NewPassword456!' });
    expect(res.status).toBe(401);
  });

  test('400: new password too short', async () => {
    const res = await request(app).put('/api/users/me/password')
      .set('Authorization', authHeader)
      .send({ current_password: TEST_PASSWORD, new_password: 'short' });
    expect(res.status).toBe(400);
  });

  test('400: missing current_password', async () => {
    const res = await request(app).put('/api/users/me/password')
      .set('Authorization', authHeader)
      .send({ new_password: 'NewPassword456!' });
    expect(res.status).toBe(400);
  });
});

// ── GET /me/sessions ──────────────────────────────────────────────────────────

describe('GET /api/users/me/sessions', () => {
  test('200: returns array of sessions', async () => {
    const sessions = [
      { id: 'sess-1', device_info: 'Chrome', ip_address: '127.0.0.1', created_at: new Date(), last_used_at: new Date() },
    ];
    mockDb.manyOrNone.mockResolvedValueOnce(sessions);

    const res = await request(app).get('/api/users/me/sessions').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.sessions)).toBe(true);
    expect(res.body.sessions).toHaveLength(1);
  });

  test('401: unauthenticated', async () => {
    const res = await request(app).get('/api/users/me/sessions');
    expect(res.status).toBe(401);
  });
});

// ── DELETE /me/sessions/:id ───────────────────────────────────────────────────

describe('DELETE /api/users/me/sessions/:id', () => {
  test('200: deletes a specific session', async () => {
    mockDb.result.mockResolvedValueOnce({ rowCount: 1 });

    const res = await request(app).delete('/api/users/me/sessions/sess-1').set('Authorization', authHeader);
    expect(res.status).toBe(200);
  });

  test('404: session not found or does not belong to user', async () => {
    mockDb.result.mockResolvedValueOnce({ rowCount: 0 });

    const res = await request(app).delete('/api/users/me/sessions/bad-sess').set('Authorization', authHeader);
    expect(res.status).toBe(404);
  });
});

// ── DELETE /me/sessions ───────────────────────────────────────────────────────

describe('DELETE /api/users/me/sessions', () => {
  test('200: revokes all sessions', async () => {
    mockDb.none.mockResolvedValueOnce(undefined);

    const res = await request(app).delete('/api/users/me/sessions').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/revoked/i);
  });
});
