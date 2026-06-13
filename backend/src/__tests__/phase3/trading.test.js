const request = require('supertest');
const express = require('express');
const { generateAccessToken } = require('../../middleware/auth');

const mockDb = {
  one: jest.fn(),
  oneOrNone: jest.fn(),
  manyOrNone: jest.fn(),
  none: jest.fn(),
};
const mockDecryptCredentials = jest.fn();
const mockGetAdapter = jest.fn();
const mockGetCurrentPrice = jest.fn();

jest.mock('../../config/database', () => ({ db: mockDb }));
jest.mock('../../config/brokerEncryption', () => ({ decryptCredentials: mockDecryptCredentials }));
jest.mock('../../services/brokers/index', () => ({ getAdapter: mockGetAdapter }));
jest.mock('../../services/marketData', () => ({ getCurrentPrice: mockGetCurrentPrice }));

const router = require('../../routes/trading');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/trading', router);
  app.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}

const USER_ID = 'user-uuid-789';
const CONN_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const ORDER_ID = 'order-uuid-001';
const POS_ID  = 'pos-uuid-001';

const userToken = generateAccessToken({ id: USER_ID, email: 'trader@test.com', role: 'user' });
const auth = `Bearer ${userToken}`;

const MOCK_CONN = { broker_id: 'alpaca', credentials_encrypted: 'enc:tag:data' };
const MOCK_ORDER = {
  id: ORDER_ID, user_id: USER_ID, symbol: 'AAPL', side: 'buy',
  order_type: 'market', quantity: 10, price: 150, status: 'pending',
  broker_connection_id: CONN_ID, created_at: new Date().toISOString(),
};
const MOCK_POSITION = {
  id: POS_ID, user_id: USER_ID, symbol: 'AAPL', position_type: 'long',
  quantity: 10, entry_price: 145, current_price: 150, pnl: 50,
  status: 'open', broker_connection_id: CONN_ID, opened_at: new Date().toISOString(),
  credentials_encrypted: 'enc:tag:data',
};

const mockAdapter = {
  placeOrder: jest.fn().mockResolvedValue({ order_id: 'broker-order-1' }),
  cancelOrder: jest.fn().mockResolvedValue(true),
  getAccountInfo: jest.fn().mockResolvedValue({ funds: { equity: 100000 } }),
};

beforeEach(() => {
  jest.resetAllMocks();
  mockDb.none.mockResolvedValue(undefined);
  mockDecryptCredentials.mockReturnValue({ api_key: 'key', secret: 'secret' });
  mockGetAdapter.mockReturnValue(mockAdapter);
  mockGetCurrentPrice.mockResolvedValue({ price: 150 });
  mockAdapter.getAccountInfo.mockResolvedValue({ funds: { equity: 100000 } });
  mockAdapter.placeOrder.mockResolvedValue({ order_id: 'broker-order-1' });
  mockAdapter.cancelOrder.mockResolvedValue(true);
  mockDb.one.mockResolvedValue({ realized_pnl: '0', count: '0' });
});

const app = createApp();

describe('POST /api/trading/orders', () => {
  test('returns 401 without auth', async () => {
    const res = await request(app).post('/api/trading/orders').send({});
    expect(res.status).toBe(401);
  });

  test('returns 400 for missing required fields', async () => {
    const res = await request(app)
      .post('/api/trading/orders')
      .set('Authorization', auth)
      .send({ symbol: 'AAPL' });
    expect(res.status).toBe(400);
  });

  test('returns 404 for unknown broker connection', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/api/trading/orders')
      .set('Authorization', auth)
      .send({ broker_connection_id: CONN_ID, symbol: 'AAPL', side: 'buy', quantity: 10 });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/broker/i);
  });

  test('creates order and returns 201', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(MOCK_CONN);
    mockDb.none.mockResolvedValue(undefined);
    const res = await request(app)
      .post('/api/trading/orders')
      .set('Authorization', auth)
      .send({ broker_connection_id: CONN_ID, symbol: 'AAPL', side: 'buy', quantity: 10 });
    expect(res.status).toBe(201);
    expect(res.body.order.symbol).toBe('AAPL');
    expect(res.body.order.side).toBe('buy');
    expect(res.body.order.status).toBe('pending');
    expect(res.body.message).toMatch(/submitted/i);
  });

  test('includes signal_id when provided', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(MOCK_CONN);
    const res = await request(app)
      .post('/api/trading/orders')
      .set('Authorization', auth)
      .send({ broker_connection_id: CONN_ID, symbol: 'AAPL', side: 'buy', quantity: 5, signal_id: '550e8400-e29b-41d4-a716-446655440000' });
    expect(res.status).toBe(201);
  });

  test('passes through stop_loss and take_profit', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(MOCK_CONN);
    const res = await request(app)
      .post('/api/trading/orders')
      .set('Authorization', auth)
      .send({ broker_connection_id: CONN_ID, symbol: 'AAPL', side: 'buy', quantity: 10, stop_loss: 140, take_profit: 170 });
    expect(res.status).toBe(201);
    expect(res.body.order.stop_loss).toBe(140);
    expect(res.body.order.take_profit).toBe(170);
  });

  test('caps quantity based on stop_loss-derived position sizing', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(MOCK_CONN);
    mockGetCurrentPrice.mockResolvedValueOnce({ price: 150 });
    // equity=100000, entry=150, stop=140 -> risk-based qty = (100000*0.01)/10 = 100, less than requested 500
    const res = await request(app)
      .post('/api/trading/orders')
      .set('Authorization', auth)
      .send({ broker_connection_id: CONN_ID, symbol: 'AAPL', side: 'buy', quantity: 500, stop_loss: 140 });
    expect(res.status).toBe(201);
    expect(res.body.order.quantity).toBe(100);
  });

  test('returns 403 when daily loss limit has been reached', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(MOCK_CONN);
    // -3% of 100000 = -3000, matches the default daily loss limit
    mockDb.one.mockResolvedValueOnce({ realized_pnl: '-3000' });
    const res = await request(app)
      .post('/api/trading/orders')
      .set('Authorization', auth)
      .send({ broker_connection_id: CONN_ID, symbol: 'AAPL', side: 'buy', quantity: 10 });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/daily loss limit/i);
  });
});

describe('GET /api/trading/orders', () => {
  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/trading/orders');
    expect(res.status).toBe(401);
  });

  test('returns paginated orders list', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce([MOCK_ORDER]);
    mockDb.one.mockResolvedValueOnce({ count: '1' });
    const res = await request(app).get('/api/trading/orders').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.orders)).toBe(true);
    expect(res.body.total).toBe(1);
  });

  test('filters by symbol and status', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce([]);
    mockDb.one.mockResolvedValueOnce({ count: '0' });
    const res = await request(app)
      .get('/api/trading/orders?symbol=AAPL&status=filled')
      .set('Authorization', auth);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/trading/orders/:id', () => {
  test('returns order by ID', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(MOCK_ORDER);
    const res = await request(app).get(`/api/trading/orders/${ORDER_ID}`).set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.order.id).toBe(ORDER_ID);
  });

  test('returns 404 for unknown order', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    const res = await request(app).get('/api/trading/orders/nonexistent').set('Authorization', auth);
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/trading/orders/:id', () => {
  test('cancels pending order', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce({ ...MOCK_ORDER, broker_order_id: null, credentials_encrypted: null });
    mockDb.none.mockResolvedValue(undefined);
    const res = await request(app).delete(`/api/trading/orders/${ORDER_ID}`).set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/cancelled/i);
    expect(res.body.order_id).toBe(ORDER_ID);
  });

  test('returns 404 for non-cancellable order', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    const res = await request(app).delete('/api/trading/orders/nonexistent').set('Authorization', auth);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/trading/positions', () => {
  test('returns open positions by default', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce([MOCK_POSITION]);
    mockDb.one.mockResolvedValueOnce({ count: '1' });
    const res = await request(app).get('/api/trading/positions').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.positions[0].symbol).toBe('AAPL');
    expect(res.body.status).toBe('open');
  });

  test('filters by closed status', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce([]);
    mockDb.one.mockResolvedValueOnce({ count: '0' });
    const res = await request(app).get('/api/trading/positions?status=closed').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('closed');
  });
});

describe('GET /api/trading/positions/:id', () => {
  test('returns position by ID', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(MOCK_POSITION);
    const res = await request(app).get(`/api/trading/positions/${POS_ID}`).set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.position.symbol).toBe('AAPL');
  });

  test('returns 404 for unknown position', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    const res = await request(app).get('/api/trading/positions/nonexistent').set('Authorization', auth);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/trading/positions/:id/close', () => {
  test('closes open position and returns P&L', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(MOCK_POSITION);
    mockDb.none.mockResolvedValue(undefined);
    const res = await request(app)
      .post(`/api/trading/positions/${POS_ID}/close`)
      .set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/closed/i);
    expect(typeof res.body.pnl).toBe('number');
    expect(typeof res.body.close_price).toBe('number');
    expect(res.body.order_id).toBeDefined();
  });

  test('returns 404 for non-existent open position', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/api/trading/positions/nonexistent/close')
      .set('Authorization', auth);
    expect(res.status).toBe(404);
  });

  test('P&L is positive when close price > entry for long', async () => {
    mockGetCurrentPrice.mockResolvedValueOnce({ price: 160 });
    mockDb.oneOrNone.mockResolvedValueOnce({ ...MOCK_POSITION, entry_price: 145, current_price: 150 });
    mockDb.none.mockResolvedValue(undefined);
    const res = await request(app)
      .post(`/api/trading/positions/${POS_ID}/close`)
      .set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.pnl).toBeGreaterThan(0);
  });
});

describe('GET /api/trading/portfolio', () => {
  test('returns portfolio summary', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce([
      { symbol: 'AAPL', position_type: 'long', total_quantity: '10', avg_entry: '145', total_pnl: '50', position_count: '1' },
    ]);
    mockDb.one.mockResolvedValueOnce({
      open_positions: '1', closed_positions: '3',
      realized_pnl: '200', unrealized_pnl: '50',
    });
    const res = await request(app).get('/api/trading/portfolio').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.positions)).toBe(true);
    expect(res.body.summary).toBeDefined();
  });
});
