const axios = require('axios');
const BaseAdapter = require('./base');

// Moomoo / Futu OpenAPI — REST endpoints for registered app developers.
// Note: Full OpenD daemon integration requires a local client. This adapter
// uses the Moomoo developer REST gateway where available.
const BASE_URL = 'https://openapi.futunn.com';

class MoomooAdapter extends BaseAdapter {
  constructor(credentials) {
    super('moomoo', credentials);
    this.http = axios.create({
      baseURL: BASE_URL,
      headers: {
        'app-id': credentials.app_id,
        Authorization: `Bearer ${credentials.access_token}`,
      },
      timeout: 10000,
    });
  }

  async validateCredentials() {
    this.requireFields('app_id', 'access_token');
    try {
      const { data } = await this.http.get('/v1/user/account-list');
      const accounts = data.data?.accountList || [];
      return { valid: true, broker: 'moomoo', account_count: accounts.length };
    } catch (err) {
      throw this.apiError(`Moomoo: ${err.response?.data?.msg || err.message}`, err.response?.status);
    }
  }

  async getAccountInfo() {
    const { data } = await this.http.get('/v1/user/account-list');
    const accounts = data.data?.accountList || [];
    return {
      broker: 'moomoo',
      accounts: accounts.map(a => ({
        account_id: a.accID,
        account_type: a.accType,
        market: a.trdMarket,
      })),
    };
  }

  async getPositions() {
    const { data } = await this.http.get('/v1/trade/position-list', {
      params: { trd_market: this.credentials.market || 'US' },
    });
    return (data.data?.positionList || []).map(p => ({
      symbol: p.code,
      market: p.trdMarket,
      quantity: p.qty,
      average_price: p.costPrice,
      last_price: p.price,
      pnl: p.unrealizedPL,
      pnl_percent: p.unrealizedPLRatio ? +(p.unrealizedPLRatio * 100).toFixed(2) : 0,
      position_type: 'long',
    }));
  }

  async getOrders(limit = 50) {
    const { data } = await this.http.get('/v1/trade/order-list', {
      params: { trd_market: this.credentials.market || 'US', limit },
    });
    return (data.data?.orderList || []).map(o => ({
      broker_order_id: o.orderID,
      symbol: o.code,
      side: o.trdSide === 1 ? 'buy' : 'sell',
      quantity: o.qty,
      price: o.price,
      status: mapStatus(o.orderStatus),
      filled_quantity: o.fillQty,
      average_price: o.fillAvgPrice,
      placed_at: o.createTime,
    }));
  }

  async refreshToken() {
    if (!this.credentials.refresh_token) return null;
    try {
      const { data } = await axios.post(`${BASE_URL}/v1/oauth/token`, {
        grant_type: 'refresh_token',
        app_id: this.credentials.app_id,
        app_secret: this.credentials.app_secret,
        refresh_token: this.credentials.refresh_token,
      }, { timeout: 10000 });
      return {
        ...this.credentials,
        access_token: data.data.access_token,
        refresh_token: data.data.refresh_token || this.credentials.refresh_token,
        expires_at: data.data.expires_in ? new Date(Date.now() + data.data.expires_in * 1000) : null,
      };
    } catch {
      return null;
    }
  }
}

function mapStatus(s) {
  const m = { 1: 'pending', 2: 'pending', 3: 'open', 4: 'partially_filled', 5: 'filled', 7: 'cancelled', 8: 'rejected', 21: 'cancelled' };
  return m[s] || 'unknown';
}

module.exports = MoomooAdapter;
