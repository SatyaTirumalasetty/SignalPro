const express = require('express');
const { body, validationResult } = require('express-validator');
const billing = require('../services/billingService');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../config/logger');

const router = express.Router();

// GET /api/billing/plans — public
router.get('/plans', asyncHandler(async (req, res) => {
  const plans = await billing.getPlans();
  res.json({ plans });
}));

// GET /api/billing/usage — current month usage
router.get('/usage', authenticate, asyncHandler(async (req, res) => {
  const usage = await billing.getUsage(req.user.id);
  res.json({ usage });
}));

// GET /api/billing/invoices
router.get('/invoices', authenticate, asyncHandler(async (req, res) => {
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const offset = parseInt(req.query.offset) || 0;
  const invoices = await billing.getInvoices(req.user.id, limit, offset);
  res.json({ invoices, limit, offset });
}));

// POST /api/billing/create-payment-intent — Stripe
router.post('/create-payment-intent', authenticate, [
  body('plan_id').isUUID(),
  body('billing_cycle').isIn(['monthly', 'annual']),
  body('currency').optional().isLength({ min: 3, max: 3 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { plan_id, billing_cycle, currency = 'usd' } = req.body;
  const intent = await billing.createStripePaymentIntent(req.user.id, plan_id, billing_cycle, currency);
  res.json(intent);
}));

// POST /api/billing/create-razorpay-order — Razorpay (INR)
router.post('/create-razorpay-order', authenticate, [
  body('plan_id').isUUID(),
  body('billing_cycle').isIn(['monthly', 'annual']),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { plan_id, billing_cycle } = req.body;
  const order = await billing.createRazorpayOrder(req.user.id, plan_id, billing_cycle);
  res.json(order);
}));

// POST /api/billing/webhooks/stripe — raw body, no auth
router.post('/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    res.sendStatus(200); // ack fast
    const sig = req.headers['stripe-signature'];
    if (!sig) return;
    try {
      const result = await billing.handleStripeWebhook(req.body, sig);
      logger.info({ type: result.type }, 'Stripe webhook processed');
    } catch (err) {
      logger.warn({ err: err.message }, 'Stripe webhook error');
    }
  }
);

module.exports = router;
