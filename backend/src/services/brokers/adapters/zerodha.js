const axios = require('axios');
const crypto = require('crypto');
const BaseAdapter = require('./base');

const BASE_URL = 'https://api.kite.trade';
const LOGIN_URL = 'https://kite.zerodha.com/connect/login';

class ZerodhaAdapter extends BaseAdapter {
  constructor(credentials) {
    super('zerodha', credentials);
    this.http = axios.create({
      baseURL: BASE_URL,
      headers: {
        'X-Kite-Version': '3',
        Authorization: `token ${credentials.api_key}:${credentials.access_token}`,
      },
      timeout: 10000,
    });
  }

  async validateCredentials() {
    this.requireFields('api_key', 'access_token');
    try {
      const { data } = await this.http.get('/user/profile');
      const u = data.data;
      return { valid: true, broker: 'zerodha', broker_user_id: u.user_id, name: u.user_name, email: u.email };
    } catch (err) {
      throw this.apiError(`Zerodha: ${err.response?.data?.message || err.message}`, err.response?.status);
    }
  }

  async getAccountInfo() {
    const [profileRes, marginsRes] = await Promise.all([
      this.http.get('/user/profile'),
      this.http.get('/user/margins'),
    ]);
    const p = profileRes.data.data;
    const m = marginsRes.data.data;
    return {
      broker: 'zerodha',
      user_id: p.user_id,
      name: p.user_name,
      email: p.email,
      exchanges: p.exchanges,
      products: p.products,
      funds: {
        equity: {
          available: m.equity?.available?.live_balance ?? 0,
          used: m.equity?.utilised?.debits ?? 0,
          net: m.equity?.net ?? 0,
        },
        commodity: {
          available: m.commodity?.available?.live_balance ?? 0,
          net: m.commodity?.net ?? 0,
        },
      },
    };
  }

  async getPositions() {
    const { data } = await this.http.get('/portfolio/positions');
    const net = data.data?.net || [];
    return net.map(p => ({
      symbol: p.tradingsymbol,
      exchange: p.exchange,
      market: 'NSE',
      quantity: p.quantity,
      average_price: p.average_price,
      last_price: p.last_price,
      pnl: p.pnl,
      pnl_percent: p.average_price > 0
        ? +((p.last_price - p.average_price) / p.average_price * 100).toFixed(2)
        : 0,
      product: p.product,
      position_type: p.quantity >= 0 ? 'long' : 'short',
    }));
  }

  async getOrders(limit = 50) {
    const { data } = await this.http.get('/orders');
    return (data.data || []).slice(0, limit).map(o => ({
      broker_order_id: o.order_id,
      symbol: o.tradingsymbol,
      exchange: o.exchange,
      side: o.transaction_type?.toLowerCase(),
      quantity: o.quantity,
      price: o.price,
      status: mapStatus(o.status),
      order_type: o.order_type?.toLowerCase(),
      filled_quantity: o.filled_quantity,
      average_price: o.average_price,
      placed_at: o.order_timestamp,
    }));
  }

  // Zerodha access tokens expire at 6am IST daily; there is no API refresh.
  // Users must re-authorize. We return null to signal re-auth required.
  async refreshToken() { return null; }

  // ── Static OAuth helpers ──────────────────────────────────────────────────

  static getOAuthUrl(apiKey) {
    return `${LOGIN_URL}?api_key=${encodeURIComponent(apiKey)}&v=3`;
  }

  // Exchange request_token for access_token after user authorizes
  static async exchangeToken(apiKey, apiSecret, requestToken) {
    const checksum = crypto
      .createHash('sha256')
      .update(`${apiKey}${requestToken}${apiSecret}`)
      .digest('hex');
    try {
      const { data } = await axios.post(
        `${BASE_URL}/session/token`,
        new URLSearchParams({ api_key: apiKey, request_token: requestToken, checksum }),
        { headers: { 'X-Kite-Version': '3', 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
      );
      return { access_token: data.data.access_token, login_time: data.data.login_time };
    } catch (err) {
      throw new Error(`Zerodha token exchange failed: ${err.response?.data?.message || err.message}`);
    }
  }
}

function mapStatus(s) {
  const m = { COMPLETE: 'filled', OPEN: 'open', CANCELLED: 'cancelled', REJECTED: 'rejected', 'TRIGGER PENDING': 'pending' };
  return m[s] || s?.toLowerCase() || 'unknown';
}

module.exports = ZerodhaAdapter;
