const request = require('supertest');
const express = require('express');
const { generateAccessToken } = require('../../middleware/auth');

const mockDb = { one: jest.fn(), oneOrNone: jest.fn(), none: jest.fn() };

const mockGetUserSubscription = jest.fn();
const mockGetPlans = jest.fn();
const mockCreateSubscription = jest.fn();
const mockChangePlan = jest.fn();
const mockCancelSubscription = jest.fn();

jest.mock('../../config/database', () => ({ db: mockDb }));
jest.mock('../../services/billingService', () => ({
  getUserSubscription: mockGetUserSubscription,
  getPlans: mockGetPlans,
  getPlan: jest.fn(),
  createSubscription: mockCreateSubscription,
  changePlan: mockChangePlan,
  cancelSubscription: mockCancelSubscription,
}));

const router = require('../../routes/subscriptions');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/subscriptions', router);
  app.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}

const USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SUB_ID  = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PLAN_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const userToken = generateAccessToken({ id: USER_ID, email: 'sub@test.com', role: 'user' });
const auth = `Bearer ${userToken}`;

const MOCK_PLAN = { id: PLAN_ID, name: 'Professional', tier: 'professional', price_monthly: 99.99 };
const MOCK_SUB = {
  id: SUB_ID, user_id: USER_ID, plan_id: PLAN_ID, status: 'active',
  billing_cycle: 'monthly', cancel_at_period_end: false,
  current_period_start: new Date().toISOString(),
  current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
};

beforeEach(() => {
  jest.resetAllMocks();
  mockDb.none.mockResolvedValue(undefined);
});

const app = createApp();

describe('GET /api/subscriptions/me', () => {
  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/subscriptions/me');
    expect(res.status).toBe(401);
  });

  test('returns active subscription', async () => {
    mockGetUserSubscription.mockResolvedValueOnce(MOCK_SUB);
    const res = await request(app).get('/api/subscriptions/me').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.subscription.status).toBe('active');
  });

  test('returns message when no subscription', async () => {
    mockGetUserSubscription.mockResolvedValueOnce(null);
    const res = await request(app).get('/api/subscriptions/me').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.subscription).toBeNull();
    expect(res.body.message).toBeDefined();
  });
});

describe('POST /api/subscriptions/create', () => {
  test('returns 401 without auth', async () => {
    const res = await request(app).post('/api/subscriptions/create').send({});
    expect(res.status).toBe(401);
  });

  test('returns 400 for invalid plan_id (not UUID)', async () => {
    const res = await request(app)
      .post('/api/subscriptions/create')
      .set('Authorization', auth)
      .send({ plan_id: 'not-a-uuid', billing_cycle: 'monthly' });
    expect(res.status).toBe(400);
  });

  test('returns 404 when plan not found', async () => {
    mockGetUserSubscription.mockResolvedValueOnce(null);
    mockGetPlans.mockResolvedValueOnce([]);
    const res = await request(app)
      .post('/api/subscriptions/create')
      .set('Authorization', auth)
      .send({ plan_id: PLAN_ID, billing_cycle: 'monthly' });
    expect(res.status).toBe(404);
  });

  test('returns 409 when subscription already exists', async () => {
    mockGetUserSubscription.mockResolvedValueOnce(MOCK_SUB);
    mockGetPlans.mockResolvedValueOnce([MOCK_PLAN]);
    const res = await request(app)
      .post('/api/subscriptions/create')
      .set('Authorization', auth)
      .send({ plan_id: PLAN_ID, billing_cycle: 'monthly' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/exists/i);
  });

  test('creates new subscription', async () => {
    mockGetUserSubscription.mockResolvedValueOnce(null);
    mockGetPlans.mockResolvedValueOnce([MOCK_PLAN]);
    mockCreateSubscription.mockResolvedValueOnce(MOCK_SUB);
    const res = await request(app)
      .post('/api/subscriptions/create')
      .set('Authorization', auth)
      .send({ plan_id: PLAN_ID, billing_cycle: 'monthly' });
    expect(res.status).toBe(201);
    expect(res.body.subscription.status).toBe('active');
    expect(res.body.message).toMatch(/professional/i);
  });
});

describe('POST /api/subscriptions/:id/change-plan', () => {
  test('returns 404 when plan not found', async () => {
    mockGetPlans.mockResolvedValueOnce([]);
    const res = await request(app)
      .post(`/api/subscriptions/${SUB_ID}/change-plan`)
      .set('Authorization', auth)
      .send({ plan_id: PLAN_ID });
    expect(res.status).toBe(404);
  });

  test('changes plan successfully', async () => {
    mockGetPlans.mockResolvedValueOnce([MOCK_PLAN]);
    mockChangePlan.mockResolvedValueOnce({ ...MOCK_SUB, plan_id: PLAN_ID });
    const res = await request(app)
      .post(`/api/subscriptions/${SUB_ID}/change-plan`)
      .set('Authorization', auth)
      .send({ plan_id: PLAN_ID });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/professional/i);
  });
});

describe('POST /api/subscriptions/:id/cancel', () => {
  test('cancels at period end by default', async () => {
    mockCancelSubscription.mockResolvedValueOnce({ ...MOCK_SUB, cancel_at_period_end: true });
    const res = await request(app)
      .post(`/api/subscriptions/${SUB_ID}/cancel`)
      .set('Authorization', auth)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/period end/i);
    expect(mockCancelSubscription).toHaveBeenCalledWith(SUB_ID, USER_ID, false);
  });

  test('cancels immediately when immediately=true', async () => {
    mockCancelSubscription.mockResolvedValueOnce({ ...MOCK_SUB, status: 'cancelled' });
    const res = await request(app)
      .post(`/api/subscriptions/${SUB_ID}/cancel`)
      .set('Authorization', auth)
      .send({ immediately: true });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/immediately/i);
    expect(mockCancelSubscription).toHaveBeenCalledWith(SUB_ID, USER_ID, true);
  });

  test('returns 404 for unknown subscription', async () => {
    mockCancelSubscription.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/api/subscriptions/nonexistent/cancel')
      .set('Authorization', auth)
      .send({});
    expect(res.status).toBe(404);
  });
});

describe('POST /api/subscriptions/:id/reactivate', () => {
  test('reactivates a scheduled-cancel subscription', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce({ ...MOCK_SUB, cancel_at_period_end: false });
    const res = await request(app)
      .post(`/api/subscriptions/${SUB_ID}/reactivate`)
      .set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/reactivated/i);
  });

  test('returns 404 when subscription not found', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/api/subscriptions/nonexistent/reactivate')
      .set('Authorization', auth);
    expect(res.status).toBe(404);
  });
});
