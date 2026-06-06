const ZerodhaAdapter           = require('./adapters/zerodha');
const AlpacaAdapter            = require('./adapters/alpaca');
const CoinbaseAdapter          = require('./adapters/coinbase');
const MoomooAdapter            = require('./adapters/moomoo');
const InteractiveBrokersAdapter = require('./adapters/interactiveBrokers');
const HDFCAdapter              = require('./adapters/hdfc');
const SaxoAdapter              = require('./adapters/saxo');

// Broker metadata — returned to clients via GET /api/brokers/supported
const BROKERS = {
  zerodha: {
    id: 'zerodha',
    name: 'Zerodha Kite',
    markets: ['NSE', 'BSE'],
    regions: ['IN'],
    auth_type: 'oauth',
    credential_fields: [
      { key: 'api_key',    label: 'API Key',    type: 'text',     required: true },
      { key: 'api_secret', label: 'API Secret', type: 'password', required: true },
    ],
    oauth_required: true,
    description: 'India\'s largest retail stockbroker.',
  },
  alpaca: {
    id: 'alpaca',
    name: 'Alpaca Markets',
    markets: ['US'],
    regions: ['US'],
    auth_type: 'api_key',
    credential_fields: [
      { key: 'api_key',    label: 'API Key',    type: 'text',     required: true },
      { key: 'api_secret', label: 'API Secret', type: 'password', required: true },
      { key: 'paper',      label: 'Paper Trading (sandbox)', type: 'boolean', required: false },
    ],
    oauth_required: false,
    description: 'US stocks & crypto. Free paper trading account available.',
  },
  coinbase: {
    id: 'coinbase',
    name: 'Coinbase Advanced Trade',
    markets: ['CRYPTO'],
    regions: ['GLOBAL'],
    auth_type: 'api_key',
    credential_fields: [
      { key: 'api_key_name', label: 'CDP API Key Name', type: 'text',     required: false, note: 'For new CDP keys' },
      { key: 'private_key',  label: 'CDP Private Key',  type: 'textarea', required: false, note: 'PEM-encoded EC key' },
      { key: 'api_key',      label: 'Legacy API Key',   type: 'text',     required: false, note: 'For legacy keys' },
      { key: 'api_secret',   label: 'Legacy API Secret',type: 'password', required: false },
      { key: 'passphrase',   label: 'Legacy Passphrase',type: 'password', required: false },
    ],
    oauth_required: false,
    description: 'Crypto trading. Supports both CDP API keys and legacy API keys.',
  },
  moomoo: {
    id: 'moomoo',
    name: 'Moomoo',
    markets: ['US', 'HK', 'SG', 'AU'],
    regions: ['GLOBAL'],
    auth_type: 'oauth',
    credential_fields: [
      { key: 'app_id',       label: 'App ID',       type: 'text',     required: true },
      { key: 'app_secret',   label: 'App Secret',   type: 'password', required: true },
      { key: 'access_token', label: 'Access Token', type: 'password', required: true },
    ],
    oauth_required: false,
    description: 'Multi-market broker for US, HK, SG, and AU markets.',
  },
  interactive_brokers: {
    id: 'interactive_brokers',
    name: 'Interactive Brokers',
    markets: ['US', 'EU', 'GLOBAL'],
    regions: ['GLOBAL'],
    auth_type: 'api_key',
    credential_fields: [
      { key: 'access_token', label: 'Access Token',  type: 'password', required: true },
      { key: 'account_id',   label: 'Account ID',    type: 'text',     required: true },
      { key: 'gateway_url',  label: 'Gateway URL',   type: 'text',     required: false, note: 'Leave blank to use IBKR cloud gateway' },
    ],
    oauth_required: false,
    description: 'Global multi-asset broker. Requires Client Portal API access.',
  },
  hdfc: {
    id: 'hdfc',
    name: 'HDFC Securities',
    markets: ['NSE', 'BSE'],
    regions: ['IN'],
    auth_type: 'api_key',
    credential_fields: [
      { key: 'api_key',      label: 'API Key',      type: 'text',     required: true },
      { key: 'access_token', label: 'Access Token', type: 'password', required: true },
      { key: 'client_code',  label: 'Client Code',  type: 'text',     required: true },
    ],
    oauth_required: false,
    description: 'HDFC Securities SKY API for NSE/BSE trading.',
  },
  saxo: {
    id: 'saxo',
    name: 'Saxo Bank',
    markets: ['FOREX', 'CFD', 'GLOBAL'],
    regions: ['GLOBAL'],
    auth_type: 'oauth',
    credential_fields: [
      { key: 'client_id',     label: 'Client ID',     type: 'text',     required: true },
      { key: 'client_secret', label: 'Client Secret', type: 'password', required: true },
    ],
    oauth_required: true,
    description: 'Global FX, CFDs, and equities. Sandbox environment available.',
  },
};

const ADAPTER_MAP = {
  zerodha:              ZerodhaAdapter,
  alpaca:               AlpacaAdapter,
  coinbase:             CoinbaseAdapter,
  moomoo:               MoomooAdapter,
  interactive_brokers:  InteractiveBrokersAdapter,
  hdfc:                 HDFCAdapter,
  saxo:                 SaxoAdapter,
};

function getAdapter(brokerId, credentials) {
  const Cls = ADAPTER_MAP[brokerId];
  if (!Cls) throw Object.assign(new Error(`Unknown broker: ${brokerId}`), { status: 400 });
  return new Cls(credentials);
}

function getBrokerMeta(brokerId) {
  return BROKERS[brokerId] || null;
}

function listBrokers() {
  return Object.values(BROKERS);
}

function isOAuthBroker(brokerId) {
  return BROKERS[brokerId]?.oauth_required === true;
}

module.exports = { getAdapter, getBrokerMeta, listBrokers, isOAuthBroker, ADAPTER_MAP };
