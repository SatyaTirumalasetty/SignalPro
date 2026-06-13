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
