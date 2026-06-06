const axios = require('axios');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const BaseAdapter = require('./base');

const BASE_URL = 'https://api.coinbase.com';

// Supports two auth modes:
//   CDP keys  (newer)  — credentials: { api_key_name, private_key }
//   Legacy    (older)  — credentials: { api_key, api_secret, passphrase }
class CoinbaseAdapter extends BaseAdapter {
  constructor(credentials) {
    super('coinbase', credentials);
    this.isCDP = !!(credentials.api_key_name && credentials.private_key);
    this.http = axios.create({ baseURL: BASE_URL, timeout: 15000 });
  }

  _authHeaders(method, path, body = '') {
    if (this.isCDP) {
      const token = this._cdpJWT(method, path);
      return { Authorization: `Bearer ${token}` };
    }
    // Legacy HMAC
    const ts = Math.floor(Date.now() / 1000).toString();
    const msg = ts + method.toUpperCase() + path + body;
    const sig = crypto.createHmac('sha256', this.credentials.api_secret).update(msg).digest('base64');
    return {
      'CB-ACCESS-KEY': this.credentials.api_key,
      'CB-ACCESS-SIGN': sig,
      'CB-ACCESS-TIMESTAMP': ts,
      'CB-ACCESS-PASSPHRASE': this.credentials.passphrase,
    };
  }

  _cdpJWT(method, path) {
    const uri = `${method.toUpperCase()} api.coinbase.com${path}`;
    return jwt.sign(
      { iss: 'cdp', sub: this.credentials.api_key_name, nbf: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 120, uri },
      this.credentials.private_key,
      { algorithm: 'ES256', header: { kid: this.credentials.api_key_name, nonce: crypto.randomBytes(10).toString('hex') } }
    );
  }

  async validateCredentials() {
    if (this.isCDP) {
      this.requireFields('api_key_name', 'private_key');
    } else {
      this.requireFields('api_key', 'api_secret', 'passphrase');
    }
    try {
      const path = '/api/v3/brokerage/accounts';
      const { data } = await this.http.get(path, { headers: this._authHeaders('GET', path) });
      return { valid: true, broker: 'coinbase', account_count: data.accounts?.length || 0 };
    } catch (err) {
      throw this.apiError(`Coinbase: ${err.response?.data?.error || err.message}`, err.response?.status);
    }
  }

  async getAccountInfo() {
    const path = '/api/v3/brokerage/accounts';
    const { data } = await this.http.get(path, { headers: this._authHeaders('GET', path) });
    const accounts = data.accounts || [];
    const funds = {};
    for (const acct of accounts) {
      if (+acct.available_balance?.value > 0) {
        funds[acct.available_balance.currency] = +acct.available_balance.value;
      }
    }
    return { broker: 'coinbase', account_count: accounts.length, funds };
  }

  async getPositions() {
    const path = '/api/v3/brokerage/portfolios';
    const { data } = await this.http.get(path, { headers: this._authHeaders('GET', path) });
    return (data.portfolios || []).map(p => ({
      symbol: p.name,
      market: 'CRYPTO',
      portfolio_id: p.uuid,
      type: p.type,
    }));
  }

  async getOrders(limit = 50) {
    const path = '/api/v3/brokerage/orders/historical/batch';
    const { data } = await this.http.get(path, {
      headers: this._authHeaders('GET', path),
      params: { limit },
    });
    return (data.orders || []).map(o => ({
      broker_order_id: o.order_id,
      symbol: o.product_id,
      side: o.side?.toLowerCase(),
      quantity: +o.order_configuration?.market_market_ioc?.base_size || 0,
      status: mapStatus(o.status),
      order_type: o.order_type?.toLowerCase(),
      placed_at: o.created_time,
    }));
  }
}

function mapStatus(s) {
  const m = { OPEN: 'open', FILLED: 'filled', CANCELLED: 'cancelled', EXPIRED: 'cancelled', FAILED: 'rejected', PENDING: 'pending' };
  return m[s] || s?.toLowerCase() || 'unknown';
}

module.exports = CoinbaseAdapter;
