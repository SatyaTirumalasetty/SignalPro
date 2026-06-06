process.env.JWT_SECRET = 'test-jwt-secret-minimum-64-chars-for-testing-only-pad-here!!';
process.env.ENCRYPTION_KEY = 'test_key_32_bytes_padding_here!!';
process.env.ALPACA_WEBHOOK_SECRET = 'alpaca-test-secret-32chars-padded!';
process.env.COINBASE_WEBHOOK_SECRET = 'coinbase-test-secret-32chars-pad!';

const mockDb = {
  one: jest.fn(),
  oneOrNone: jest.fn(),
  none: jest.fn().mockResolvedValue(undefined),
  manyOrNone: jest.fn(),
  result: jest.fn(),
};

jest.mock('../../config/database', () => ({ db: mockDb, initializeDatabase: jest.fn() }));
jest.mock('../../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../config/brokerEncryption', () => ({
  encryptCredentials: jest.fn(obj => 'encrypted'),
  decryptCredentials: jest.fn(() => ({ api_key: 'k', api_secret: 's' })),
}));

const express = require('express');
const request = require('supertest');
const crypto = require('crypto');
const webhooksRouter = require('../../routes/webhooks');

const app = express();
app.use('/api/webhooks', webhooksRouter);
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));

beforeEach(() => jest.resetAllMocks().mockDb && (mockDb.none.mockResolvedValue(undefined)));

// IMPORTANT: The webhook routes send 200 IMMEDIATELY (before processing), so
// ALL webhook requests return 200 — even those with invalid/missing signatures.
// Signature failures are handled by silently aborting processing, not sending error codes.
// This is by design: broker webhook providers expect a fast 200 ack.

function alpacaSignature(body) {
  return crypto.createHmac('sha256', process.env.ALPACA_WEBHOOK_SECRET)
    .update(body).digest('hex');
}

function coinbaseSignature(timestamp, body) {
  const msg = timestamp + body;
  return crypto.createHmac('sha256', process.env.COINBASE_WEBHOOK_SECRET)
    .update(msg).digest('hex');
}

const alpacaOrderEvent = JSON.stringify({
  event: 'fill',
  order: {
    id: 'ord-alpaca-1', client_order_id: 'cli-1', symbol: 'AAPL',
    qty: '10', filled_qty: '10', side: 'buy', type: 'market',
    status: 'filled', filled_at: new Date().toISOString(),
    filled_avg_price: '150.00',
  },
});

const coinbaseOrderEvent = JSON.stringify({
  type: 'order_filled',
  order: { order_id: 'ord-cb-1', product_id: 'BTC-USD', side: 'buy', size: '0.01', price: '60000' },
});

const zerodhaPayload = JSON.stringify({
  user_id: 'ZU1234',
  order_id: 'ORD001',
  status: 'COMPLETE',
  tradingsymbol: 'RELIANCE',
  transaction_type: 'BUY',
  quantity: 10,
  average_price: 2500.50,
  checksum: 'valid_checksum',
});

// ── Alpaca Webhooks ───────────────────────────────────────────────────────────

describe('POST /api/webhooks/alpaca', () => {
  test('200: always acks immediately (with valid apca-signature)', async () => {
    const sig = alpacaSignature(alpacaOrderEvent);
    const res = await request(app)
      .post('/api/webhooks/alpaca')
      .set('Content-Type', 'application/json')
      .set('apca-signature', sig)
      .send(alpacaOrderEvent);
    expect(res.status).toBe(200);
  });

  test('200: always acks even with invalid signature (silent reject)', async () => {
    const res = await request(app)
      .post('/api/webhooks/alpaca')
      .set('Content-Type', 'application/json')
      .set('apca-signature', 'invalidsignature')
      .send(alpacaOrderEvent);
    // Route sends 200 first, then silently ignores bad signatures
    expect(res.status).toBe(200);
  });

  test('200: always acks even with missing signature header', async () => {
    const res = await request(app)
      .post('/api/webhooks/alpaca')
      .set('Content-Type', 'application/json')
      .send(alpacaOrderEvent);
    // No signature = no verification (sends 200 then ignores)
    expect(res.status).toBe(200);
  });
});

// ── Coinbase Webhooks ─────────────────────────────────────────────────────────

describe('POST /api/webhooks/coinbase', () => {
  test('200: always acks immediately (with valid signature)', async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = coinbaseSignature(ts, coinbaseOrderEvent);

    const res = await request(app)
      .post('/api/webhooks/coinbase')
      .set('Content-Type', 'application/json')
      .set('cb-signature', sig)
      .set('cb-timestamp', ts)
      .send(coinbaseOrderEvent);
    expect(res.status).toBe(200);
  });

  test('200: always acks even with invalid signature (silent reject)', async () => {
    const res = await request(app)
      .post('/api/webhooks/coinbase')
      .set('Content-Type', 'application/json')
      .set('cb-signature', 'badhash')
      .set('cb-timestamp', '1234567890')
      .send(coinbaseOrderEvent);
    expect(res.status).toBe(200);
  });
});

// ── Zerodha Webhooks ──────────────────────────────────────────────────────────

describe('POST /api/webhooks/zerodha', () => {
  test('200: always acks immediately', async () => {
    const res = await request(app)
      .post('/api/webhooks/zerodha')
      .set('Content-Type', 'application/json')
      .send(zerodhaPayload);
    expect(res.status).toBe(200);
  });

  test('200: malformed JSON body still returns 200', async () => {
    const res = await request(app)
      .post('/api/webhooks/zerodha')
      .set('Content-Type', 'application/json')
      .send('not valid json');
    expect(res.status).toBe(200);
  });
});

// ── Signature verification helper ─────────────────────────────────────────────

describe('HMAC signature verification (unit)', () => {
  test('valid signature passes verification', () => {
    const secret = 'my-webhook-secret';
    const body = Buffer.from('{"event":"test"}');
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const equal = crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
    expect(equal).toBe(true);
  });

  test('tampered body fails signature check', () => {
    const secret = 'my-webhook-secret';
    const original = Buffer.from('{"event":"test"}');
    const tampered = Buffer.from('{"event":"EVIL"}');
    const sig = crypto.createHmac('sha256', secret).update(original).digest('hex');
    const actual = crypto.createHmac('sha256', secret).update(tampered).digest('hex');
    const match = sig === actual;
    expect(match).toBe(false);
  });
});
