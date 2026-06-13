const request = require('supertest');
const express = require('express');
const { generateAccessToken } = require('../../middleware/auth');

const mockGetPlans = jest.fn();
const mockGetUsage = jest.fn();
const mockGetInvoices = jest.fn();
const mockCreatePaymentIntent = jest.fn();
const mockCreateRazorpayOrder = jest.fn();
const mockHandleStripeWebhook = jest.fn();

jest.mock('../../services/billingService', () => ({
  getPlans: mockGetPlans,
  getUsage: mockGetUsage,
  getInvoices: mockGetInvoices,
  createStripePaymentIntent: mockCreatePaymentIntent,
  createRazorpayOrder: mockCreateRazorpayOrder,
  handleStripeWebhook: mockHandleStripeWebhook,
}));

const router = require('../../routes/billing');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/billing', router);
  app.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}

const USER_ID  = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const PLAN_UUID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const userToken = generateAccessToken({ id: USER_ID, email: 'billing@test.com', role: 'user' });
const auth = `Bearer ${userToken}`;

const MOCK_PLANS = [
  { id: 'plan-1', name: 'Starter', tier: 'starter', price_monthly: 29.99 },
  { id: 'plan-2', name: 'Professional', tier: 'professional', price_monthly: 99.99 },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockHandleStripeWebhook.mockResolvedValue({ received: true, type: 'test' });
});

const app = createApp();

describe('GET /api/billing/plans (public)', () => {
  test('returns plans without auth', async () => {
    mockGetPlans.mockResolvedValueOnce(MOCK_PLANS);
    const res = await request(app).get('/api/billing/plans');
    expect(res.status).toBe(200);
    expect(res.body.plans).toHaveLength(2);
    expect(res.body.plans[0].name).toBe('Starter');
  });

  test('returns empty array when no plans', async () => {
    mockGetPlans.mockResolvedValueOnce([]);
    const res = await request(app).get('/api/billing/plans');
    expect(res.status).toBe(200);
    expect(res.body.plans).toHaveLength(0);
  });
});

describe('GET /api/billing/usage', () => {
  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/billing/usage');
    expect(res.status).toBe(401);
  });

  test('returns usage metrics for authenticated user', async () => {
    mockGetUsage.mockResolvedValueOnce([{ metric_name: 'ai_analyses', usage_count: 5 }]);
    const res = await request(app).get('/api/billing/usage').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.usage[0].metric_name).toBe('ai_analyses');
  });
});

describe('GET /api/billing/invoices', () => {
  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/billing/invoices');
    expect(res.status).toBe(401);
  });

  test('returns invoice list', async () => {
    mockGetInvoices.mockResolvedValueOnce([{ id: 'inv-1', amount: 99.99 }]);
    const res = await request(app).get('/api/billing/invoices').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.invoices).toHaveLength(1);
  });
});

describe('POST /api/billing/create-payment-intent', () => {
  test('returns 401 without auth', async () => {
    const res = await request(app).post('/api/billing/create-payment-intent').send({});
    expect(res.status).toBe(401);
  });

  test('returns 400 for missing plan_id', async () => {
    const res = await request(app)
      .post('/api/billing/create-payment-intent')
      .set('Authorization', auth)
      .send({ billing_cycle: 'monthly' });
    expect(res.status).toBe(400);
  });

  test('creates Stripe payment intent', async () => {
    mockCreatePaymentIntent.mockResolvedValueOnce({
      client_secret: 'pi_secret', amount: 9999, currency: 'usd', plan: 'Professional',
    });
    const res = await request(app)
      .post('/api/billing/create-payment-intent')
      .set('Authorization', auth)
      .send({ plan_id: PLAN_UUID, billing_cycle: 'monthly' });
    expect(res.status).toBe(200);
    expect(res.body.client_secret).toBe('pi_secret');
  });

  test('propagates 503 when Stripe not configured', async () => {
    mockCreatePaymentIntent.mockRejectedValueOnce(
      Object.assign(new Error('Stripe not configured'), { status: 503 })
    );
    const res = await request(app)
      .post('/api/billing/create-payment-intent')
      .set('Authorization', auth)
      .send({ plan_id: PLAN_UUID, billing_cycle: 'monthly' });
    expect(res.status).toBe(503);
  });
});

describe('POST /api/billing/create-razorpay-order', () => {
  test('returns 401 without auth', async () => {
    const res = await request(app).post('/api/billing/create-razorpay-order').send({});
    expect(res.status).toBe(401);
  });

  test('creates Razorpay order', async () => {
    mockCreateRazorpayOrder.mockResolvedValueOnce({
      order_id: 'order_rz_123', amount: 8299, currency: 'INR', plan: 'Professional',
    });
    const res = await request(app)
      .post('/api/billing/create-razorpay-order')
      .set('Authorization', auth)
      .send({ plan_id: PLAN_UUID, billing_cycle: 'monthly' });
    expect(res.status).toBe(200);
    expect(res.body.order_id).toBe('order_rz_123');
    expect(res.body.currency).toBe('INR');
  });
});

describe('POST /api/billing/webhooks/stripe', () => {
  test('always returns 200 immediately', async () => {
    const res = await request(app)
      .post('/api/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'test-sig')
      .send(JSON.stringify({ type: 'payment_intent.succeeded' }));
    expect(res.status).toBe(200);
  });

  test('returns 200 even without stripe-signature header', async () => {
    const res = await request(app)
      .post('/api/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'test' }));
    expect(res.status).toBe(200);
  });

  test('returns 200 even when webhook handler throws', async () => {
    mockHandleStripeWebhook.mockRejectedValueOnce(new Error('webhook error'));
    const res = await request(app)
      .post('/api/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'bad-sig')
      .send(JSON.stringify({ type: 'test' }));
    expect(res.status).toBe(200);
  });
});
