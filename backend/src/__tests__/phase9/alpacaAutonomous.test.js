const axios = require('axios');
jest.mock('axios');

const AlpacaAdapter = require('../../services/brokers/adapters/alpaca');
const BaseAdapter = require('../../services/brokers/adapters/base');

const http = { get: jest.fn(), post: jest.fn(), delete: jest.fn(), patch: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  axios.create.mockReturnValue(http);
});

function adapter() {
  return new AlpacaAdapter({ api_key: 'k', api_secret: 's', paper: true });
}

describe('capabilities', () => {
  test('base adapter has none', () => {
    expect(new BaseAdapter('other', {}).capabilities()).toEqual([]);
  });

  test('alpaca supports autonomous trading', () => {
    expect(adapter().capabilities()).toEqual(
      expect.arrayContaining(['place_order', 'cancel_order', 'close_position', 'replace_order', 'open_orders'])
    );
  });

  test('base autonomous methods throw not-supported', async () => {
    const base = new BaseAdapter('other', {});
    await expect(base.closePosition('AAPL')).rejects.toThrow(/does not support/);
    await expect(base.getOpenOrders('AAPL')).rejects.toThrow(/does not support/);
    await expect(base.replaceOrder('id', {})).rejects.toThrow(/does not support/);
  });
});

describe('alpaca getOpenOrders', () => {
  test('maps open orders including stop_price', async () => {
    http.get.mockResolvedValue({
      data: [{ id: 'o1', symbol: 'AAPL', side: 'sell', type: 'stop', qty: '10', stop_price: '95.5', limit_price: null, status: 'new' }],
    });
    const orders = await adapter().getOpenOrders('AAPL');
    expect(http.get).toHaveBeenCalledWith('/v2/orders', { params: { status: 'open', symbols: 'AAPL' } });
    expect(orders).toEqual([{
      broker_order_id: 'o1', symbol: 'AAPL', side: 'sell', order_type: 'stop',
      quantity: 10, stop_price: 95.5, limit_price: null, status: 'pending',
    }]);
  });
});

describe('alpaca closePosition', () => {
  test('closes whole position via DELETE /v2/positions/:symbol', async () => {
    http.delete.mockResolvedValue({ data: { id: 'close-1', status: 'accepted' } });
    const res = await adapter().closePosition('AAPL');
    expect(http.delete).toHaveBeenCalledWith('/v2/positions/AAPL', { params: {} });
    expect(res.order_id).toBe('close-1');
  });

  test('passes qty for partial close', async () => {
    http.delete.mockResolvedValue({ data: { id: 'close-2', status: 'accepted' } });
    await adapter().closePosition('AAPL', 5);
    expect(http.delete).toHaveBeenCalledWith('/v2/positions/AAPL', { params: { qty: '5' } });
  });

  test('wraps API errors', async () => {
    http.delete.mockRejectedValue({ response: { data: { message: 'position not found' }, status: 404 } });
    await expect(adapter().closePosition('AAPL')).rejects.toThrow(/position not found/);
  });
});

describe('alpaca replaceOrder', () => {
  test('patches stop_price', async () => {
    http.patch.mockResolvedValue({ data: { id: 'o2', status: 'replaced' } });
    const res = await adapter().replaceOrder('o1', { stop_price: 97 });
    expect(http.patch).toHaveBeenCalledWith('/v2/orders/o1', { stop_price: '97' });
    expect(res.order_id).toBe('o2');
  });
});
