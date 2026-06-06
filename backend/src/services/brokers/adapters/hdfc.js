const axios = require('axios');
const crypto = require('crypto');
const BaseAdapter = require('./base');

// HDFC Securities SKY API
// Docs: https://developer.hdfcsec.com/
const BASE_URL = 'https://api.hdfcsec.com';

class HDFCAdapter extends BaseAdapter {
  constructor(credentials) {
    super('hdfc', credentials);
    this.http = axios.create({
      baseURL: BASE_URL,
      headers: {
        'x-api-key': credentials.api_key,
        Authorization: `Bearer ${credentials.access_token}`,
      },
      timeout: 10000,
    });
    this.clientCode = credentials.client_code;
  }

  async validateCredentials() {
    this.requireFields('api_key', 'access_token', 'client_code');
    try {
      const { data } = await this.http.get('/v1/profile', { params: { client_code: this.clientCode } });
      return {
        valid: true,
        broker: 'hdfc',
        broker_user_id: data.data?.clientCode,
        name: data.data?.name,
      };
    } catch (err) {
      throw this.apiError(`HDFC: ${err.response?.data?.message || err.message}`, err.response?.status);
    }
  }

  async getAccountInfo() {
    const { data } = await this.http.get('/v1/funds', { params: { client_code: this.clientCode } });
    const f = data.data || {};
    return {
      broker: 'hdfc',
      client_code: this.clientCode,
      funds: {
        available: f.net_available,
        used: f.used_margin,
        net: f.net_value,
        currency: 'INR',
      },
    };
  }

  async getPositions() {
    const { data } = await this.http.get('/v1/positions', { params: { client_code: this.clientCode } });
    return (data.data || []).map(p => ({
      symbol: p.symbol,
      exchange: p.exchange,
      market: 'NSE',
      quantity: p.net_qty,
      average_price: p.avg_price,
      last_price: p.ltp,
      pnl: p.pnl,
      pnl_percent: p.avg_price > 0 ? +((p.ltp - p.avg_price) / p.avg_price * 100).toFixed(2) : 0,
      product: p.product,
      position_type: p.net_qty >= 0 ? 'long' : 'short',
    }));
  }

  async getOrders(limit = 50) {
    const { data } = await this.http.get('/v1/orders', { params: { client_code: this.clientCode } });
    return (data.data || []).slice(0, limit).map(o => ({
      broker_order_id: o.order_id,
      symbol: o.symbol,
      exchange: o.exchange,
      side: o.transaction_type?.toLowerCase(),
      quantity: o.qty,
      price: o.price,
      status: mapStatus(o.status),
      order_type: o.order_type?.toLowerCase(),
      filled_quantity: o.filled_qty || 0,
      average_price: o.avg_price,
      placed_at: o.order_time,
    }));
  }

  async refreshToken() {
    if (!this.credentials.refresh_token) return null;
    try {
      const { data } = await axios.post(`${BASE_URL}/v1/token/refresh`, {
        client_code: this.clientCode,
        refresh_token: this.credentials.refresh_token,
      }, { headers: { 'x-api-key': this.credentials.api_key }, timeout: 10000 });
      return {
        ...this.credentials,
        access_token: data.data.access_token,
        refresh_token: data.data.refresh_token || this.credentials.refresh_token,
      };
    } catch {
      return null;
    }
  }
}

function mapStatus(s) {
  const m = {
    complete: 'filled', open: 'open', cancelled: 'cancelled',
    rejected: 'rejected', 'trigger pending': 'pending', pending: 'pending',
  };
  return m[s?.toLowerCase()] || s?.toLowerCase() || 'unknown';
}

module.exports = HDFCAdapter;
