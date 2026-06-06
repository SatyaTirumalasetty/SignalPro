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
