class BaseAdapter {
  constructor(brokerId, credentials) {
    this.brokerId = brokerId;
    this.credentials = credentials;
  }

  // Returns { valid: true, broker_user_id, name, ... } or throws
  async validateCredentials() {
    throw new Error(`${this.brokerId}: validateCredentials not implemented`);
  }

  // Returns standardized account info object
  async getAccountInfo() {
    throw new Error(`${this.brokerId}: getAccountInfo not implemented`);
  }

  // Returns array of position objects
  async getPositions() {
    throw new Error(`${this.brokerId}: getPositions not implemented`);
  }

  // Returns array of order objects
  async getOrders(_limit = 50) {
    throw new Error(`${this.brokerId}: getOrders not implemented`);
  }

  // Places an order with the broker.
  // Args: { symbol, side, order_type, quantity, price, stop_loss, take_profit }
  // Returns { order_id, status, message }
  async placeOrder(_order) {
    throw new Error(`${this.brokerId}: placeOrder not implemented`);
  }

  // Cancels an open order by broker order ID. Returns true on success.
  async cancelOrder(_brokerOrderId) {
    throw new Error(`${this.brokerId}: cancelOrder not implemented`);
  }

  // Autonomous-trading capabilities. Brokers that can't do these degrade to
  // skipped_unsupported_broker in the engine — never a silent no-op.
  capabilities() {
    return [];
  }

  async getOpenOrders(_symbol) {
    throw this.apiError(`${this.brokerId} does not support autonomous trading via SignalPro`, 501);
  }

  async closePosition(_symbol, _quantity = null) {
    throw this.apiError(`${this.brokerId} does not support autonomous trading via SignalPro`, 501);
  }

  async replaceOrder(_brokerOrderId, _changes = {}) {
    throw this.apiError(`${this.brokerId} does not support autonomous trading via SignalPro`, 501);
  }

  // Returns updated credentials object if tokens were refreshed, else null
  async refreshToken() {
    return null;
  }

  credentialError(field) {
    const err = new Error(`Missing required credential: ${field}`);
    err.code = 'MISSING_CREDENTIAL';
    err.status = 400;
    return err;
  }

  apiError(message, status = 502) {
    const err = new Error(message);
    err.code = 'BROKER_API_ERROR';
    err.status = status;
    return err;
  }

  requireFields(...fields) {
    for (const f of fields) {
      if (!this.credentials[f]) throw this.credentialError(f);
    }
  }
}

module.exports = BaseAdapter;
