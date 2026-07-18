const axios = require('axios');
const BaseAdapter = require('./base');

class AlpacaAdapter extends BaseAdapter {
  constructor(credentials) {
    super('alpaca', credentials);
    const base = credentials.paper
      ? 'https://paper-api.alpaca.markets'
      : 'https://api.alpaca.markets';
    this.http = axios.create({
      baseURL: base,
      headers: {
        'APCA-API-KEY-ID': credentials.api_key,
        'APCA-API-SECRET-KEY': credentials.api_secret,
      },
      timeout: 10000,
    });
  }

  async validateCredentials() {
    this.requireFields('api_key', 'api_secret');
    try {
      const { data } = await this.http.get('/v2/account');
      return {
        valid: true,
        broker: 'alpaca',
        broker_user_id: data.id,
        account_number: data.account_number,
        status: data.status,
        paper: this.credentials.paper || false,
      };
    } catch (err) {
      throw this.apiError(`Alpaca: ${err.response?.data?.message || err.message}`, err.response?.status);
    }
  }

  async getAccountInfo() {
    const { data } = await this.http.get('/v2/account');
    return {
      broker: 'alpaca',
      account_id: data.id,
      account_number: data.account_number,
      status: data.status,
      currency: data.currency,
      paper: this.credentials.paper || false,
      funds: {
        equity: +data.equity,
        cash: +data.cash,
        buying_power: +data.buying_power,
        portfolio_value: +data.portfolio_value,
        day_trade_count: data.daytrade_count,
      },
      trading_blocked: data.trading_blocked,
      pattern_day_trader: data.pattern_day_trader,
    };
  }

  async getPositions() {
    const { data } = await this.http.get('/v2/positions');
    return data.map(p => ({
      symbol: p.symbol,
      market: 'US',
      quantity: +p.qty,
      average_price: +p.avg_entry_price,
      last_price: +p.current_price,
      pnl: +p.unrealized_pl,
      pnl_percent: +(+p.unrealized_plpc * 100).toFixed(2),
      market_value: +p.market_value,
      position_type: p.side === 'long' ? 'long' : 'short',
    }));
  }

  async getOrders(limit = 50) {
    const { data } = await this.http.get('/v2/orders', {
      params: { limit, status: 'all', direction: 'desc' },
    });
    return data.map(o => ({
      broker_order_id: o.id,
      symbol: o.symbol,
      side: o.side,
      quantity: +o.qty,
      price: o.limit_price ? +o.limit_price : null,
      status: mapStatus(o.status),
      order_type: o.type,
      filled_quantity: +(o.filled_qty || 0),
      average_price: o.filled_avg_price ? +o.filled_avg_price : null,
      placed_at: o.created_at,
    }));
  }

  async placeOrder({ symbol, side, order_type = 'market', quantity, price, stop_loss, take_profit }) {
    const body = {
      symbol,
      qty: String(quantity),
      side,
      type: order_type,
      time_in_force: 'day',
    };

    if (order_type === 'limit' && price) body.limit_price = String(price);
    if (order_type === 'stop' && price) body.stop_price = String(price);

    if (stop_loss || take_profit) {
      body.order_class = 'bracket';
      if (take_profit) body.take_profit = { limit_price: String(take_profit) };
      if (stop_loss) body.stop_loss = { stop_price: String(stop_loss) };
    }

    try {
      const { data } = await this.http.post('/v2/orders', body);
      return {
        order_id: data.id,
        status: mapStatus(data.status),
        message: `Alpaca order ${data.id} ${data.status}`,
      };
    } catch (err) {
      throw this.apiError(`Alpaca: ${err.response?.data?.message || err.message}`, err.response?.status);
    }
  }

  async cancelOrder(brokerOrderId) {
    try {
      await this.http.delete(`/v2/orders/${brokerOrderId}`);
      return true;
    } catch (err) {
      throw this.apiError(`Alpaca: ${err.response?.data?.message || err.message}`, err.response?.status);
    }
  }

  capabilities() {
    return ['place_order', 'cancel_order', 'close_position', 'replace_order', 'open_orders', 'market_clock'];
  }

  async isMarketOpen() {
    try {
      const { data } = await this.http.get('/v2/clock');
      return data.is_open === true;
    } catch (err) {
      throw this.apiError(`Alpaca: ${err.response?.data?.message || err.message}`, err.response?.status);
    }
  }

  async getOpenOrders(symbol) {
    try {
      const { data } = await this.http.get('/v2/orders', { params: { status: 'open', symbols: symbol } });
      return data.map(o => ({
        broker_order_id: o.id,
        symbol: o.symbol,
        side: o.side,
        order_type: o.type,
        quantity: +o.qty,
        stop_price: o.stop_price ? +o.stop_price : null,
        limit_price: o.limit_price ? +o.limit_price : null,
        status: mapStatus(o.status),
      }));
    } catch (err) {
      throw this.apiError(`Alpaca: ${err.response?.data?.message || err.message}`, err.response?.status);
    }
  }

  async closePosition(symbol, quantity = null) {
    try {
      const params = quantity ? { qty: String(quantity) } : {};
      const { data } = await this.http.delete(`/v2/positions/${encodeURIComponent(symbol)}`, { params });
      return { order_id: data.id, status: mapStatus(data.status), message: `Alpaca close order ${data.id} ${data.status}` };
    } catch (err) {
      throw this.apiError(`Alpaca: ${err.response?.data?.message || err.message}`, err.response?.status);
    }
  }

  async replaceOrder(brokerOrderId, { stop_price, limit_price, quantity } = {}) {
    const body = {};
    if (stop_price != null) body.stop_price = String(stop_price);
    if (limit_price != null) body.limit_price = String(limit_price);
    if (quantity != null) body.qty = String(quantity);
    try {
      const { data } = await this.http.patch(`/v2/orders/${brokerOrderId}`, body);
      return { order_id: data.id, status: mapStatus(data.status), message: `Alpaca order ${brokerOrderId} replaced by ${data.id}` };
    } catch (err) {
      throw this.apiError(`Alpaca: ${err.response?.data?.message || err.message}`, err.response?.status);
    }
  }
}

function mapStatus(s) {
  const m = {
    new: 'pending', accepted: 'pending', held: 'pending',
    pending_cancel: 'pending', pending_replace: 'pending',
    partially_filled: 'partially_filled', filled: 'filled',
    done_for_day: 'filled', canceled: 'cancelled', expired: 'cancelled',
    replaced: 'cancelled', rejected: 'rejected',
  };
  return m[s] || s;
}

module.exports = AlpacaAdapter;
