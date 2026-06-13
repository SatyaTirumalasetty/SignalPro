const axios = require('axios');
const BaseAdapter = require('./base');

// Interactive Brokers — Client Portal Web API
// Base URL is the IBKR gateway, which can be self-hosted or pointed at IBKR's cloud portal.
// Default: https://api.ibkr.com/v1/api (requires OAuth 2.0 session)
// Self-hosted gateway: https://localhost:5000/v1/api

// Only the official IBKR cloud gateway or a local self-hosted gateway are
// permitted as the API base — prevents SSRF via an arbitrary user-supplied URL.
const DEFAULT_GATEWAY = 'https://api.ibkr.com/v1/api';
const LOCAL_GATEWAY_RE = /^https:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/v1\/api$/;

class InteractiveBrokersAdapter extends BaseAdapter {
  constructor(credentials) {
    super('interactive_brokers', credentials);
    const base = InteractiveBrokersAdapter.resolveGatewayUrl(credentials.gateway_url);
    this.http = axios.create({
      baseURL: base,
      headers: { Authorization: `Bearer ${credentials.access_token}` },
      timeout: 15000,
      // Self-hosted gateway uses self-signed cert; disable SSL check only in dev
      ...(base !== DEFAULT_GATEWAY && {
        httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
      }),
    });
    this.accountId = credentials.account_id;
  }

  static resolveGatewayUrl(gatewayUrl) {
    if (!gatewayUrl) return DEFAULT_GATEWAY;
    if (gatewayUrl === DEFAULT_GATEWAY || LOCAL_GATEWAY_RE.test(gatewayUrl)) return gatewayUrl;
    const err = new Error('Invalid gateway_url: must be the IBKR API or a local self-hosted gateway (https://localhost:<port>/v1/api)');
    err.code = 'MISSING_CREDENTIAL';
    err.status = 400;
    throw err;
  }

  async validateCredentials() {
    this.requireFields('access_token', 'account_id');
    try {
      const { data } = await this.http.get('/portal/iserver/auth/status');
      if (!data.authenticated) throw this.apiError('IBKR session not authenticated — re-login required', 401);
      return { valid: true, broker: 'interactive_brokers', account_id: this.accountId, authenticated: data.authenticated };
    } catch (err) {
      if (err.code === 'BROKER_API_ERROR') throw err;
      throw this.apiError(`IBKR: ${err.response?.data?.error || err.message}`, err.response?.status);
    }
  }

  async getAccountInfo() {
    const { data } = await this.http.get(`/portal/portfolio/${this.accountId}/summary`);
    return {
      broker: 'interactive_brokers',
      account_id: this.accountId,
      funds: {
        net_liquidation: data.netliquidation?.amount,
        equity_with_loan: data.equitywithloanvalue?.amount,
        available_funds: data.availablefunds?.amount,
        buying_power: data.buyingpower?.amount,
        cash: data.cashbalance?.amount,
        currency: data.netliquidation?.currency || 'USD',
      },
    };
  }

  async getPositions() {
    const { data } = await this.http.get(`/portal/portfolio/${this.accountId}/positions/0`);
    return (data || []).map(p => ({
      symbol: p.ticker,
      market: p.listingExchange,
      quantity: p.position,
      average_price: p.avgCost,
      last_price: p.mktPrice,
      pnl: p.unrealizedPnl,
      pnl_percent: p.avgCost > 0 ? +((p.mktPrice - p.avgCost) / p.avgCost * 100).toFixed(2) : 0,
      market_value: p.mktValue,
      position_type: p.position >= 0 ? 'long' : 'short',
      asset_class: p.assetClass,
    }));
  }

  async getOrders(limit = 50) {
    const { data } = await this.http.get('/portal/iserver/account/orders');
    return (data?.orders || []).slice(0, limit).map(o => ({
      broker_order_id: o.orderId?.toString(),
      symbol: o.ticker,
      side: o.side?.toLowerCase(),
      quantity: o.remainingQuantity + (o.filledQuantity || 0),
      price: o.price,
      status: mapStatus(o.status),
      order_type: o.orderType?.toLowerCase(),
      filled_quantity: o.filledQuantity || 0,
      placed_at: o.lastExecutionTime_r ? new Date(o.lastExecutionTime_r) : null,
    }));
  }

  // IBKR access tokens require periodic tickling (GET /portal/tickle) to stay alive
  async refreshToken() {
    try {
      await this.http.post('/portal/tickle');
      return this.credentials; // same credentials, session refreshed
    } catch {
      return null;
    }
  }
}

function mapStatus(s) {
  const m = {
    Submitted: 'open', PreSubmitted: 'pending', Filled: 'filled',
    Cancelled: 'cancelled', Inactive: 'cancelled', PartiallyFilled: 'partially_filled',
    ApiPending: 'pending', ApiCancelled: 'cancelled',
  };
  return m[s] || s?.toLowerCase() || 'unknown';
}

module.exports = InteractiveBrokersAdapter;
