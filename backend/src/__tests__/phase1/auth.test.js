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
jest.mock('../../services/emailService', () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('otplib', () => ({
  authenticator: {
    generateSecret: jest.fn(() => 'TESTSECRETBASE32'),
    keyuri: jest.fn(() => 'otpauth://totp/SignalPro:test@test.com?secret=TESTSECRETBASE32'),
    verify: jest.fn(() => true),
  },
}));
jest.mock('qrcode', () => ({ toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,qrtest') }));

const express = require('express');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const authRouter = require('../../routes/auth');
const { generateAccessToken, generateTwoFaToken } = require('../../middleware/auth');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../../services/emailService');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);
app.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

const TEST_PASSWORD = 'Password123!';
const TEST_HASH = bcrypt.hashSync(TEST_PASSWORD, 1);
const testUser = { id: 'user-uuid-1', email: 'test@signalpro.com', role: 'user', status: 'active', totp_enabled: false, totp_secret: null };

beforeEach(() => jest.clearAllMocks());

// ── Register ──────────────────────────────────────────────────────────────────

describe('POST /api/auth/register', () => {
  test('201: creates user and sends verification email', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    mockDb.one.mockResolvedValueOnce({ id: testUser.id, email: testUser.email, full_name: 'Test User', status: 'active' });
    mockDb.none.mockResolvedValueOnce(undefined);

    const res = await request(app).post('/api/auth/register')
      .send({ email: testUser.email, password: TEST_PASSWORD, full_name: 'Test User' });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(testUser.email);
    expect(res.body.message).toMatch(/verify/i);
    expect(sendVerificationEmail).toHaveBeenCalledWith(testUser.email, expect.any(String));
  });

  test('409: duplicate email returns conflict', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce({ id: 'existing-id' });

    const res = await request(app).post('/api/auth/register')
      .send({ email: testUser.email, password: TEST_PASSWORD, full_name: 'Test User' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already registered/i);
  });

  test('400: invalid email format', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ email: 'not-an-email', password: TEST_PASSWORD, full_name: 'Test' });
    expect(res.status).toBe(400);
  });

  test('400: password too short', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ email: testUser.email, password: 'short', full_name: 'Test' });
    expect(res.status).toBe(400);
  });

  test('400: missing full_name', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ email: testUser.email, password: TEST_PASSWORD });
    expect(res.status).toBe(400);
  });
});

// ── Login ─────────────────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  test('200: valid credentials return tokens', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce({ ...testUser, password_hash: TEST_HASH });
    mockDb.none.mockResolvedValueOnce(undefined);

    const res = await request(app).post('/api/auth/login')
      .send({ email: testUser.email, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user.email).toBe(testUser.email);
  });

  test('401: user not found', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'nope@example.com', password: TEST_PASSWORD });
    expect(res.status).toBe(401);
  });

  test('401: wrong password', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce({ ...testUser, password_hash: TEST_HASH });
    const res = await request(app).post('/api/auth/login')
      .send({ email: testUser.email, password: 'WrongPassword!' });
    expect(res.status).toBe(401);
  });

  test('403: suspended account', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce({ ...testUser, password_hash: TEST_HASH, status: 'suspended' });
    const res = await request(app).post('/api/auth/login')
      .send({ email: testUser.email, password: TEST_PASSWORD });
    expect(res.status).toBe(403);
  });

  test('200: 2FA enabled returns challenge token', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce({ ...testUser, password_hash: TEST_HASH, totp_enabled: true, totp_secret: 'SECRET' });
    const res = await request(app).post('/api/auth/login')
      .send({ email: testUser.email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.requires_2fa).toBe(true);
    expect(res.body.two_fa_token).toBeDefined();
  });
});

// ── 2FA Challenge ─────────────────────────────────────────────────────────────

describe('POST /api/auth/2fa/challenge', () => {
  test('200: valid challenge returns full tokens', async () => {
    const twoFaToken = generateTwoFaToken(testUser.id);
    mockDb.oneOrNone.mockResolvedValueOnce({ ...testUser, totp_enabled: true, totp_secret: 'SECRET' });
    mockDb.none.mockResolvedValueOnce(undefined);

    const res = await request(app).post('/api/auth/2fa/challenge')
      .send({ two_fa_token: twoFaToken, totp_code: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
  });

  test('401: invalid 2FA token', async () => {
    const res = await request(app).post('/api/auth/2fa/challenge')
      .send({ two_fa_token: 'invalid.token.here', totp_code: '123456' });
    expect(res.status).toBe(401);
  });

  test('401: wrong TOTP code', async () => {
    const { authenticator } = require('otplib');
    authenticator.verify.mockReturnValueOnce(false);

    const twoFaToken = generateTwoFaToken(testUser.id);
    mockDb.oneOrNone.mockResolvedValueOnce({ ...testUser, totp_enabled: true, totp_secret: 'SECRET' });

    const res = await request(app).post('/api/auth/2fa/challenge')
      .send({ two_fa_token: twoFaToken, totp_code: '000000' });
    expect(res.status).toBe(401);
  });

  test('400: totp_code must be 6 digits', async () => {
    const twoFaToken = generateTwoFaToken(testUser.id);
    const res = await request(app).post('/api/auth/2fa/challenge')
      .send({ two_fa_token: twoFaToken, totp_code: '12' });
    expect(res.status).toBe(400);
  });
});

// ── Refresh Token ─────────────────────────────────────────────────────────────

describe('POST /api/auth/refresh', () => {
  test('200: valid refresh token returns new access token', async () => {
    const { generateRefreshToken } = require('../../middleware/auth');
    const refreshToken = generateRefreshToken(testUser);
    mockDb.oneOrNone.mockResolvedValueOnce(testUser);

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
  });

  test('400: missing refresh token', async () => {
    const res = await request(app).post('/api/auth/refresh').send({});
    expect(res.status).toBe(400);
  });

  test('403: invalid refresh token', async () => {
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: 'bad.token' });
    expect(res.status).toBe(403);
  });
});

// ── Email Verification ────────────────────────────────────────────────────────

describe('POST /api/auth/verify-email', () => {
  test('200: valid token verifies email', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce({ user_id: testUser.id });

    const res = await request(app).post('/api/auth/verify-email').send({ token: 'valid-token-abc' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/verified/i);
  });

  test('400: invalid or expired token', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    const res = await request(app).post('/api/auth/verify-email').send({ token: 'expired-token' });
    expect(res.status).toBe(400);
  });

  test('400: missing token field', async () => {
    const res = await request(app).post('/api/auth/verify-email').send({});
    expect(res.status).toBe(400);
  });
});

// ── Forgot / Reset Password ───────────────────────────────────────────────────

describe('POST /api/auth/forgot-password', () => {
  test('200: known email sends reset link (enum-safe response)', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce({ id: testUser.id });
    mockDb.none.mockResolvedValue(undefined);

    const res = await request(app).post('/api/auth/forgot-password').send({ email: testUser.email });
    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();
    expect(sendPasswordResetEmail).toHaveBeenCalled();
  });

  test('200: unknown email still returns 200 (prevents enumeration)', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  test('400: invalid email format', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'notvalid' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/reset-password', () => {
  test('200: valid token resets password', async () => {
    const rawToken = 'valid-reset-token-32bytes-padding!!';
    mockDb.oneOrNone.mockResolvedValueOnce({ id: 'prt-1', user_id: testUser.id });

    const res = await request(app).post('/api/auth/reset-password')
      .send({ token: rawToken, password: 'NewPassword123!' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/reset/i);
  });

  test('400: invalid or used token', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    const res = await request(app).post('/api/auth/reset-password')
      .send({ token: 'bad-token', password: 'NewPassword123!' });
    expect(res.status).toBe(400);
  });

  test('400: new password too short', async () => {
    const res = await request(app).post('/api/auth/reset-password')
      .send({ token: 'some-token', password: 'short' });
    expect(res.status).toBe(400);
  });
});

// ── 2FA Setup / Enable / Disable ──────────────────────────────────────────────

describe('POST /api/auth/2fa/setup', () => {
  test('200: returns TOTP secret and QR code', async () => {
    const token = generateAccessToken(testUser);
    mockDb.oneOrNone.mockResolvedValueOnce({ ...testUser, totp_enabled: false });
    mockDb.none.mockResolvedValueOnce(undefined);

    const res = await request(app).post('/api/auth/2fa/setup')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.secret).toBeDefined();
    expect(res.body.qr_code).toMatch(/^data:image/);
  });

  test('400: 2FA already enabled', async () => {
    const token = generateAccessToken(testUser);
    mockDb.oneOrNone.mockResolvedValueOnce({ ...testUser, totp_enabled: true });

    const res = await request(app).post('/api/auth/2fa/setup')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/2fa/enable', () => {
  test('200: valid TOTP code enables 2FA', async () => {
    const token = generateAccessToken(testUser);
    mockDb.oneOrNone.mockResolvedValueOnce({ ...testUser, totp_secret: 'SECRET', totp_enabled: false });
    mockDb.none.mockResolvedValueOnce(undefined);

    const res = await request(app).post('/api/auth/2fa/enable')
      .set('Authorization', `Bearer ${token}`)
      .send({ totp_code: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/enabled/i);
  });

  test('400: invalid TOTP code', async () => {
    const { authenticator } = require('otplib');
    authenticator.verify.mockReturnValueOnce(false);
    const token = generateAccessToken(testUser);
    mockDb.oneOrNone.mockResolvedValueOnce({ ...testUser, totp_secret: 'SECRET', totp_enabled: false });

    const res = await request(app).post('/api/auth/2fa/enable')
      .set('Authorization', `Bearer ${token}`)
      .send({ totp_code: '000000' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/auth/2fa', () => {
  test('200: valid TOTP code disables 2FA', async () => {
    const token = generateAccessToken(testUser);
    mockDb.oneOrNone.mockResolvedValueOnce({ ...testUser, totp_enabled: true, totp_secret: 'SECRET' });
    mockDb.none.mockResolvedValueOnce(undefined);

    const res = await request(app).delete('/api/auth/2fa')
      .set('Authorization', `Bearer ${token}`)
      .send({ totp_code: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/disabled/i);
  });

  test('400: 2FA not enabled', async () => {
    const token = generateAccessToken(testUser);
    mockDb.oneOrNone.mockResolvedValueOnce({ ...testUser, totp_enabled: false });

    const res = await request(app).delete('/api/auth/2fa')
      .set('Authorization', `Bearer ${token}`)
      .send({ totp_code: '123456' });
    expect(res.status).toBe(400);
  });

  test('401: unauthenticated request', async () => {
    const res = await request(app).delete('/api/auth/2fa').send({ totp_code: '123456' });
    expect(res.status).toBe(401);
  });
});
