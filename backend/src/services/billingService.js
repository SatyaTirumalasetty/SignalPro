const { db } = require('../config/database');
const logger = require('../config/logger');

// ── Stripe ────────────────────────────────────────────────────────────────────

let stripeClient = null;
function getStripe() {
  if (!stripeClient) {
    if (!process.env.STRIPE_SECRET_KEY) return null;
    stripeClient = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

// ── Razorpay ──────────────────────────────────────────────────────────────────

let razorpayClient = null;
function getRazorpay() {
  if (!razorpayClient) {
    const key_id = process.env.RAZORPAY_KEY_ID;
    const key_secret = process.env.RAZORPAY_KEY_SECRET;
    if (!key_id || !key_secret) return null;
    const Razorpay = require('razorpay');
    razorpayClient = new Razorpay({ key_id, key_secret });
  }
  return razorpayClient;
}

// ── Plan helpers ──────────────────────────────────────────────────────────────

async function getPlans() {
  return db.manyOrNone('SELECT * FROM pricing_plans WHERE active = TRUE ORDER BY price_monthly ASC');
}

async function getPlan(tier) {
  return db.oneOrNone('SELECT * FROM pricing_plans WHERE tier = $1 AND active = TRUE', [tier]);
}

// ── Subscription management ───────────────────────────────────────────────────

async function getUserSubscription(userId) {
  return db.oneOrNone(
    `SELECT s.*, p.name as plan_name, p.tier, p.price_monthly, p.price_annual,
            p.ai_analysis_credits, p.max_positions, p.features
     FROM subscriptions s
     JOIN pricing_plans p ON s.plan_id = p.id
     WHERE s.user_id = $1 AND s.status IN ('active', 'past_due')
     ORDER BY s.created_at DESC LIMIT 1`,
    [userId]
  );
}

async function createSubscription(userId, planId, billingCycle, paymentMethod) {
  const now = new Date();
  const periodEnd = new Date(now);
  if (billingCycle === 'annual') periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  else periodEnd.setMonth(periodEnd.getMonth() + 1);

  return db.one(
    `INSERT INTO subscriptions
       (user_id, plan_id, status, billing_cycle, current_period_start, current_period_end, payment_method)
     VALUES ($1, $2, 'active', $3, $4, $5, $6)
     RETURNING *`,
    [userId, planId, billingCycle, now, periodEnd, paymentMethod]
  );
}

async function cancelSubscription(subscriptionId, userId, immediately = false) {
  if (immediately) {
    return db.one(
      `UPDATE subscriptions SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP,
              cancel_at_period_end = FALSE, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [subscriptionId, userId]
    );
  }
  return db.one(
    `UPDATE subscriptions SET cancel_at_period_end = TRUE, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND user_id = $2 RETURNING *`,
    [subscriptionId, userId]
  );
}

async function changePlan(subscriptionId, userId, newPlanId) {
  return db.one(
    `UPDATE subscriptions SET plan_id = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND user_id = $3 AND status = 'active' RETURNING *`,
    [newPlanId, subscriptionId, userId]
  );
}

async function getUsage(userId) {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return db.manyOrNone(
    `SELECT metric_name, usage_count, limit_count
     FROM usage_metrics
     WHERE user_id = $1 AND billing_period_start = $2`,
    [userId, periodStart]
  );
}

// ── Stripe payment intent ─────────────────────────────────────────────────────

async function createStripePaymentIntent(userId, planId, billingCycle, currency = 'usd') {
  const stripe = getStripe();
  if (!stripe) throw Object.assign(new Error('Stripe not configured'), { status: 503 });

  const plan = await db.oneOrNone('SELECT * FROM pricing_plans WHERE id = $1', [planId]);
  if (!plan) throw Object.assign(new Error('Plan not found'), { status: 404 });

  const amount = Math.round((billingCycle === 'annual' ? plan.price_annual : plan.price_monthly) * 100);

  const intent = await stripe.paymentIntents.create({
    amount,
    currency,
    metadata: { user_id: userId, plan_id: planId, billing_cycle: billingCycle },
  });

  return { client_secret: intent.client_secret, amount, currency, plan: plan.name };
}

// ── Stripe webhook processing ─────────────────────────────────────────────────

async function handleStripeWebhook(rawBody, signature) {
  const stripe = getStripe();
  if (!stripe) throw Object.assign(new Error('Stripe not configured'), { status: 503 });

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    throw Object.assign(new Error(`Webhook signature invalid: ${err.message}`), { status: 401 });
  }

  logger.info({ type: event.type }, 'Stripe webhook received');

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object;
      const { user_id, plan_id } = pi.metadata;
      if (user_id && plan_id) {
        await db.none(
          `INSERT INTO payments (user_id, amount, currency, status, payment_method, transaction_id, gateway_response, completed_at)
           VALUES ($1, $2, $3, 'completed', 'stripe', $4, $5, CURRENT_TIMESTAMP)`,
          [user_id, pi.amount / 100, pi.currency.toUpperCase(), pi.id, JSON.stringify({ id: pi.id, status: pi.status })]
        ).catch(err => logger.warn({ err: err.message }, 'Failed to record Stripe payment'));
      }
      break;
    }
    case 'invoice.payment_failed': {
      const inv = event.data.object;
      const userId = inv.metadata?.user_id;
      if (userId) {
        await db.none(
          `UPDATE subscriptions SET status = 'past_due', updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $1 AND status = 'active'`,
          [userId]
        ).catch(() => {});
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const userId = sub.metadata?.user_id;
      if (userId) {
        await db.none(
          `UPDATE subscriptions SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $1 AND status IN ('active','past_due')`,
          [userId]
        ).catch(() => {});
      }
      break;
    }
  }

  return { received: true, type: event.type };
}

// ── Razorpay order creation ───────────────────────────────────────────────────

async function createRazorpayOrder(userId, planId, billingCycle) {
  const razorpay = getRazorpay();
  if (!razorpay) throw Object.assign(new Error('Razorpay not configured'), { status: 503 });

  const plan = await db.oneOrNone('SELECT * FROM pricing_plans WHERE id = $1', [planId]);
  if (!plan) throw Object.assign(new Error('Plan not found'), { status: 404 });

  const amountPaise = Math.round((billingCycle === 'annual' ? plan.price_annual : plan.price_monthly) * 100);
  const order = await razorpay.orders.create({
    amount: amountPaise,
    currency: 'INR',
    notes: { user_id: userId, plan_id: planId, billing_cycle: billingCycle },
  });

  return { order_id: order.id, amount: order.amount, currency: order.currency, plan: plan.name };
}

// ── Invoice helpers ───────────────────────────────────────────────────────────

async function getInvoices(userId, limit = 20, offset = 0) {
  return db.manyOrNone(
    `SELECT i.*, s.billing_cycle, p.name as plan_name
     FROM invoices i
     LEFT JOIN subscriptions s ON i.subscription_id = s.id
     LEFT JOIN pricing_plans p ON s.plan_id = p.id
     WHERE i.user_id = $1
     ORDER BY i.created_at DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
}

module.exports = {
  getPlans, getPlan, getUserSubscription, createSubscription, cancelSubscription,
  changePlan, getUsage, createStripePaymentIntent, handleStripeWebhook,
  createRazorpayOrder, getInvoices,
};
