const axios = require('axios');
const BaseAdapter = require('./base');

// Saxo Bank OpenAPI — OAuth 2.0
// Docs: https://www.developer.saxo/openapi/learn
const BASE_URL = 'https://gateway.saxobank.com/sim/openapi'; // sim = sandbox
const LIVE_URL = 'https://gateway.saxobank.com/openapi';
const TOKEN_URL = 'https://live.logonvalidation.net/token';
const AUTH_URL = 'https://live.logonvalidation.net/authorize';

class SaxoAdapter extends BaseAdapter {
  constructor(credentials) {
    super('saxo', credentials);
    const base = credentials.live ? LIVE_URL : BASE_URL;
    this.http = axios.create({
      baseURL: base,
      headers: { Authorization: `Bearer ${credentials.access_token}` },
      timeout: 10000,
    });
  }

  async validateCredentials() {
    this.requireFields('access_token');
    try {
      const { data } = await this.http.get('/port/v1/users/me');
      return {
        valid: true,
        broker: 'saxo',
        broker_user_id: data.UserId,
        name: data.Name,
        client_key: data.ClientKey,
      };
    } catch (err) {
      throw this.apiError(`Saxo: ${err.response?.data?.Message || err.message}`, err.response?.status);
    }
  }

  async getAccountInfo() {
    const [userRes, balanceRes] = await Promise.all([
      this.http.get('/port/v1/users/me'),
      this.http.get('/port/v1/balances'),
    ]);
    const u = userRes.data;
    const b = balanceRes.data;
    return {
      broker: 'saxo',
      user_id: u.UserId,
      name: u.Name,
      client_key: u.ClientKey,
      funds: {
        net_equity_for_margin: b.NetEquityForMargin,
        margin_available: b.MarginAvailableForTrading,
        unrealized_positions_value: b.UnrealizedPositionsValue,
        cash: b.CashBalance,
        currency: b.Currency,
      },
    };
  }

  async getPositions() {
    const { data } = await this.http.get('/port/v1/positions/me');
    return (data.Data || []).map(p => ({
      symbol: p.DisplayAndFormat?.Symbol || p.Uic?.toString(),
      market: p.DisplayAndFormat?.ExchangeId,
      quantity: p.NetPositionBase?.Amount,
      average_price: p.NetPositionBase?.AverageOpenPrice,
      last_price: p.NetPositionBase?.CurrentPrice,
      pnl: p.NetPositionBase?.ProfitLossOnTrade,
      pnl_percent: p.NetPositionBase?.AverageOpenPrice > 0
        ? +((p.NetPositionBase.CurrentPrice - p.NetPositionBase.AverageOpenPrice) / p.NetPositionBase.AverageOpenPrice * 100).toFixed(2)
        : 0,
      asset_type: p.NetPositionBase?.AssetType,
      position_type: (p.NetPositionBase?.Amount || 0) >= 0 ? 'long' : 'short',
    }));
  }

  async getOrders(limit = 50) {
    const { data } = await this.http.get('/trade/v2/orders/me', { params: { '$top': limit } });
    return (data.Data || []).map(o => ({
      broker_order_id: o.OrderId,
      symbol: o.DisplayAndFormat?.Symbol,
      side: o.BuySell?.toLowerCase(),
      quantity: o.Amount,
      price: o.Price,
      status: mapStatus(o.Status),
      order_type: o.OrderType?.toLowerCase(),
      filled_quantity: o.FilledAmount || 0,
      placed_at: o.OrderTime,
    }));
  }

  async refreshToken() {
    if (!this.credentials.refresh_token || !this.credentials.client_id || !this.credentials.client_secret) {
      return null;
    }
    try {
      const { data } = await axios.post(TOKEN_URL,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.credentials.refresh_token,
          client_id: this.credentials.client_id,
          client_secret: this.credentials.client_secret,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
      );
      return {
        ...this.credentials,
        access_token: data.access_token,
        refresh_token: data.refresh_token || this.credentials.refresh_token,
        expires_at: new Date(Date.now() + (data.expires_in || 1200) * 1000),
      };
    } catch {
      return null;
    }
  }

  // ── Static OAuth helpers ──────────────────────────────────────────────────

  static getOAuthUrl(clientId, redirectUri, state) {
    const p = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state });
    return `${AUTH_URL}?${p}`;
  }

  static async exchangeToken(clientId, clientSecret, code, redirectUri) {
    const { data } = await axios.post(TOKEN_URL,
      new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
    );
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      expires_at: new Date(Date.now() + (data.expires_in || 1200) * 1000),
    };
  }
}

function mapStatus(s) {
  const m = {
    Working: 'open', Partiallyfilled: 'partially_filled', Filled: 'filled',
    Cancelled: 'cancelled', Expired: 'cancelled', Rejected: 'rejected',
    Locked: 'pending', Unknown: 'pending',
  };
  return m[s] || s?.toLowerCase() || 'unknown';
}

module.exports = SaxoAdapter;
