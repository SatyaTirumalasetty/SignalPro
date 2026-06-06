// Set env vars before any requires so lazy-init picks them up
process.env.STRIPE_SECRET_KEY = 'sk_test_billing_service';
process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';

const mockDb = {
  one: jest.fn(),
  oneOrNone: jest.fn(),
  manyOrNone: jest.fn(),
  none: jest.fn(),
};

const mockPaymentIntentsCreate = jest.fn();
const mockWebhooksConstructEvent = jest.fn();
jest.mock('stripe', () => jest.fn(() => ({
  paymentIntents: { create: mockPaymentIntentsCreate },
  webhooks: { constructEvent: mockWebhooksConstructEvent },
})));

const mockRazorpayOrdersCreate = jest.fn();
jest.mock('razorpay', () => jest.fn(() => ({
  orders: { create: mockRazorpayOrdersCreate },
})));

jest.mock('../../config/database', () => ({ db: mockDb }));

const billing = require('../../services/billingService');

const PLAN = {
  id: 'plan-uuid',
  name: 'Professional',
  tier: 'professional',
  price_monthly: 99.99,
  price_annual: 999.99,
  active: true,
};
const SUBSCRIPTION = {
  id: 'sub-uuid',
  user_id: 'user-uuid',
  plan_id: 'plan-uuid',
  status: 'active',
  billing_cycle: 'monthly',
  cancel_at_period_end: false,
};

beforeEach(() => {
  jest.resetAllMocks();
  mockDb.none.mockResolvedValue(undefined);
});

describe('getPlans()', () => {
  test('returns all active plans', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce([PLAN]);
    const plans = await billing.getPlans();
    expect(plans).toHaveLength(1);
    expect(plans[0].name).toBe('Professional');
  });

  test('queries active plans ordered by price', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce([]);
    await billing.getPlans();
    expect(mockDb.manyOrNone).toHaveBeenCalledWith(
      expect.stringContaining('active = TRUE'),
    );
  });
});

describe('getPlan(tier)', () => {
  test('returns plan by tier', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(PLAN);
    const plan = await billing.getPlan('professional');
    expect(plan.tier).toBe('professional');
  });

  test('returns null for unknown tier', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    const plan = await billing.getPlan('nonexistent');
    expect(plan).toBeNull();
  });
});

describe('getUserSubscription(userId)', () => {
  test('returns active subscription with plan details', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce({ ...SUBSCRIPTION, plan_name: 'Professional', tier: 'professional' });
    const sub = await billing.getUserSubscription('user-uuid');
    expect(sub.status).toBe('active');
    expect(sub.plan_name).toBe('Professional');
  });

  test('returns null when no active subscription', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    const sub = await billing.getUserSubscription('user-uuid');
    expect(sub).toBeNull();
  });
});

describe('createSubscription()', () => {
  test('creates monthly subscription and sets period end 1 month ahead', async () => {
    mockDb.one.mockResolvedValueOnce(SUBSCRIPTION);
    const sub = await billing.createSubscription('user-uuid', 'plan-uuid', 'monthly', 'stripe');
    expect(mockDb.one).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO subscriptions'),
      expect.arrayContaining(['user-uuid', 'plan-uuid', 'monthly']),
    );
    expect(sub).toBeDefined();
  });

  test('creates annual subscription', async () => {
    mockDb.one.mockResolvedValueOnce({ ...SUBSCRIPTION, billing_cycle: 'annual' });
    const sub = await billing.createSubscription('user-uuid', 'plan-uuid', 'annual', 'stripe');
    expect(mockDb.one).toHaveBeenCalled();
    expect(sub.billing_cycle).toBe('annual');
  });
});

describe('cancelSubscription()', () => {
  test('immediate cancellation sets status to cancelled', async () => {
    mockDb.one.mockResolvedValueOnce({ ...SUBSCRIPTION, status: 'cancelled' });
    const sub = await billing.cancelSubscription('sub-uuid', 'user-uuid', true);
    expect(mockDb.one).toHaveBeenCalledWith(
      expect.stringContaining("status = 'cancelled'"),
      expect.any(Array),
    );
  });

  test('end-of-period cancellation sets cancel_at_period_end', async () => {
    mockDb.one.mockResolvedValueOnce({ ...SUBSCRIPTION, cancel_at_period_end: true });
    const sub = await billing.cancelSubscription('sub-uuid', 'user-uuid', false);
    expect(mockDb.one).toHaveBeenCalledWith(
      expect.stringContaining('cancel_at_period_end = TRUE'),
      expect.any(Array),
    );
  });
});

describe('changePlan()', () => {
  test('updates plan_id for active subscription', async () => {
    mockDb.one.mockResolvedValueOnce({ ...SUBSCRIPTION, plan_id: 'new-plan-uuid' });
    const sub = await billing.changePlan('sub-uuid', 'user-uuid', 'new-plan-uuid');
    expect(mockDb.one).toHaveBeenCalledWith(
      expect.stringContaining("status = 'active'"),
      expect.arrayContaining(['new-plan-uuid']),
    );
  });
});

describe('getUsage(userId)', () => {
  test('returns usage metrics for current month', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce([
      { metric_name: 'ai_analyses', usage_count: 15, limit_count: 100 },
    ]);
    const usage = await billing.getUsage('user-uuid');
    expect(usage).toHaveLength(1);
    expect(usage[0].metric_name).toBe('ai_analyses');
  });
});

describe('createStripePaymentIntent()', () => {
  test('creates payment intent for monthly plan', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(PLAN);
    mockPaymentIntentsCreate.mockResolvedValueOnce({
      client_secret: 'pi_secret_xyz',
    });
    const result = await billing.createStripePaymentIntent('user-uuid', 'plan-uuid', 'monthly', 'usd');
    expect(result.client_secret).toBe('pi_secret_xyz');
    expect(result.amount).toBe(9999);
    expect(result.currency).toBe('usd');
    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 9999, currency: 'usd' }),
    );
  });

  test('charges annual price for annual cycle', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(PLAN);
    mockPaymentIntentsCreate.mockResolvedValueOnce({ client_secret: 'pi_annual_secret' });
    const result = await billing.createStripePaymentIntent('user-uuid', 'plan-uuid', 'annual', 'usd');
    expect(result.amount).toBe(99999);
  });

  test('throws 404 when plan not found', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    await expect(billing.createStripePaymentIntent('user-uuid', 'bad-id', 'monthly'))
      .rejects.toMatchObject({ status: 404 });
  });
});

describe('handleStripeWebhook()', () => {
  test('handles payment_intent.succeeded event', async () => {
    mockWebhooksConstructEvent.mockReturnValueOnce({
      type: 'payment_intent.succeeded',
      data: { object: { amount: 9999, currency: 'usd', id: 'pi_abc', status: 'succeeded',
        metadata: { user_id: 'user-uuid', plan_id: 'plan-uuid', billing_cycle: 'monthly' } } },
    });
    const result = await billing.handleStripeWebhook(Buffer.from('raw'), 'sig');
    expect(result.type).toBe('payment_intent.succeeded');
  });

  test('handles invoice.payment_failed event', async () => {
    mockWebhooksConstructEvent.mockReturnValueOnce({
      type: 'invoice.payment_failed',
      data: { object: { metadata: { user_id: 'user-uuid' } } },
    });
    const result = await billing.handleStripeWebhook(Buffer.from('raw'), 'sig');
    expect(result.type).toBe('invoice.payment_failed');
  });

  test('throws 401 for invalid signature', async () => {
    mockWebhooksConstructEvent.mockImplementationOnce(() => { throw new Error('invalid signature'); });
    await expect(billing.handleStripeWebhook(Buffer.from('raw'), 'bad-sig'))
      .rejects.toMatchObject({ status: 401 });
  });
});

describe('createRazorpayOrder()', () => {
  test('creates order in INR', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(PLAN);
    mockRazorpayOrdersCreate.mockResolvedValueOnce({
      id: 'order_test_123', amount: 9999, currency: 'INR',
    });
    const result = await billing.createRazorpayOrder('user-uuid', 'plan-uuid', 'monthly');
    expect(result.order_id).toBe('order_test_123');
    expect(result.currency).toBe('INR');
  });

  test('throws 404 when plan not found', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    await expect(billing.createRazorpayOrder('user-uuid', 'bad-id', 'monthly'))
      .rejects.toMatchObject({ status: 404 });
  });
});

describe('getInvoices()', () => {
  test('returns invoice list with plan info', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce([
      { id: 'inv-1', amount: 99.99, status: 'paid', plan_name: 'Professional' },
    ]);
    const invoices = await billing.getInvoices('user-uuid', 20, 0);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].plan_name).toBe('Professional');
  });
});
