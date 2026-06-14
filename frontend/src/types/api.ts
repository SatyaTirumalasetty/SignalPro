export interface User {
  id: string
  email: string
  full_name: string
  phone?: string
  country?: string
  status?: string
  role?: string
  email_verified?: boolean
  totp_enabled?: boolean
  kyc_status?: string
  preferences?: Record<string, unknown>
  created_at?: string
  updated_at?: string
}

export interface LoginResponse {
  accessToken?: string
  refreshToken?: string
  user?: User
  requires_2fa?: boolean
  two_fa_token?: string
}

export interface Order {
  id: string
  symbol: string
  side: 'buy' | 'sell'
  order_type: string
  quantity: number
  price?: number
  stop_loss?: number | null
  take_profit?: number | null
  status: string
  broker_order_id?: string
  executed_at?: string
  created_at: string
}

export interface BacktestSummary {
  total_trades: number
  win_count: number
  loss_count: number
  win_rate: number
  avg_win: number
  avg_loss: number
  total_return_pct: number
  max_drawdown_pct: number
  initial_equity: number
  final_equity: number
}

export interface BacktestTrade {
  entry_time: string
  exit_time: string
  entry_price: number
  exit_price: number
  quantity: number
  pnl: number
  exit_reason: string
}

export interface BacktestEquityPoint {
  time: string
  equity: number
}

export interface BacktestResult {
  summary: BacktestSummary
  trades: BacktestTrade[]
  equity_curve: BacktestEquityPoint[]
}

export interface Position {
  id: string
  symbol: string
  position_type: string
  quantity: number
  entry_price: number
  current_price?: number
  pnl?: number
  pnl_percent?: number
  opened_at?: string
  closed_at?: string
  status?: string
}

export interface PortfolioSummaryRow {
  symbol: string
  position_type: string
  total_quantity: number
  avg_entry: number
  total_pnl: number
  position_count: number
}

export interface PortfolioSummary {
  positions: PortfolioSummaryRow[]
  summary: {
    open_positions: number
    closed_positions: number
    realized_pnl: number
    unrealized_pnl: number
  }
}

export interface NewsItem {
  id?: string | number
  headline: string
  summary?: string
  source?: string
  url?: string
  symbols?: string[]
  created_at?: string
}

export interface Signal {
  id: string
  symbol: string
  signal_type: string
  confidence: number
  timeframe?: string
  status?: string
  entry_price?: number
  stop_loss?: number
  take_profit?: number
  predicted_price_high?: number
  predicted_price_low?: number
  analysis_text?: string
  actual_result?: string
  expires_at?: string
  created_at?: string
  indicators?: { news?: NewsItem[]; [key: string]: unknown }
}

export interface LiveQuote {
  symbol: string
  source: 'alpaca' | 'yahoo'
  price: number | null
  bid?: number | null
  ask?: number | null
  timestamp?: string
}

export interface SignalPerformance {
  by_type: Array<{
    signal_type: string
    total: number
    executed: number
    avg_confidence: number
    avg_pnl_percent: number
  }>
  overall: {
    total_signals: number
    executed: number
    avg_confidence: number
    total_tokens_used: number
  }
}

export interface Candle {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface MarketSnapshot {
  symbol: string
  interval: string
  price: {
    symbol: string
    price: number
    change?: number
    change_percent?: number
    timestamp?: string
  }
  indicators: Record<string, unknown>
  recent_candles: Candle[]
  calculated_at?: string
}

export interface SearchResult {
  symbol: string
  name: string
  type: string
}

export interface BrokerConnection {
  id: string
  broker_id: string
  name: string
  status: string
  account_info?: Record<string, unknown> | null
  last_sync?: string | null
  sync_error?: string | null
  connected_at?: string
  disconnected_at?: string | null
  updated_at?: string
  token_expires_at?: string | null
}

export interface CredentialField {
  key: string
  label: string
  type: 'text' | 'password' | 'boolean' | 'textarea'
  required: boolean
  note?: string
}

export interface SupportedBroker {
  id: string
  name: string
  markets?: string[]
  regions?: string[]
  auth_type?: 'oauth' | 'api_key'
  credential_fields?: CredentialField[]
  oauth_required?: boolean
  description?: string
}

export interface PricingPlan {
  id: string
  name: string
  tier: string
  description: string | null
  price_monthly: number | string
  price_annual: number | string
  ai_analysis_credits: number
  max_positions: number
  max_watchlists: number
  max_api_calls_per_minute: number
  features: Record<string, unknown>
  active: boolean
  created_at: string
  updated_at: string
}

export interface Subscription {
  id: string
  user_id: string
  plan_id: string
  status: 'active' | 'paused' | 'cancelled' | 'past_due'
  billing_cycle: 'monthly' | 'annual'
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  payment_method: string | null
  last_payment_id: string | null
  auto_renew: boolean
  created_at: string
  updated_at: string
  cancelled_at: string | null
  plan_name?: string
  tier?: string
  price_monthly?: number | string
  price_annual?: number | string
  ai_analysis_credits?: number
  max_positions?: number
  features?: Record<string, unknown>
}

export interface UsageMetric {
  metric_name: string
  usage_count: number
  limit_count: number | null
}

export interface Invoice {
  id: string
  user_id: string
  subscription_id: string | null
  amount: number | string
  currency: string
  status: 'draft' | 'sent' | 'paid' | 'failed' | 'refunded'
  payment_date: string | null
  due_date: string | null
  invoice_number: string | null
  pdf_url: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
  billing_cycle: 'monthly' | 'annual' | null
  plan_name: string | null
}

export interface Session {
  id: string
  ip_address: string | null
  user_agent: string | null
  device_name: string | null
  last_activity: string | null
  created_at: string
  expires_at: string
}

export interface ApiKey {
  id: string
  name: string
  last_used_at: string | null
  last_ip: string | null
  rate_limit: number | null
  scope: string[]
  active: boolean
  created_at: string
  expires_at: string | null
}

export interface ApiKeyCreateResponse {
  api_key: {
    id: string
    name: string
    key: string
    scope?: string[]
    created_at: string
    expires_at?: string | null
  }
  warning: string
}

export interface TwoFaSetupResponse {
  secret: string
  otpauth_url: string
  qr_code: string
}

export interface ApiError {
  error: string
  errors?: Array<{ field: string; message: string }>
}

export interface AdminUserSummary {
  id: string
  email: string
  full_name: string
  status: string
  kyc_status: string
  email_verified: boolean
  created_at: string
  totp_enabled: boolean
  subscription_status: string | null
  plan_tier: string | null
  broker_count: string | number
}

export interface AdminUserDetail {
  id: string
  email: string
  full_name: string
  status: string
  kyc_status: string
  email_verified: boolean
  created_at: string
  updated_at: string
  totp_enabled: boolean
  subscription_status: string | null
  plan_name: string | null
  plan_tier: string | null
}

export interface AdminActivityEntry {
  action: string
  entity_type: string
  status: string
  created_at: string
}

export interface AdminMrrPoint {
  month: string
  mrr: string
  new_subs: string
}

export interface AdminRevenueByPlan {
  name: string
  tier: string
  subscriber_count: string
  mrr: string
}

export interface AdminSignalStat {
  symbol: string
  signal_type: string
  total: number
  avg_confidence: string
  executed: number
}

export interface AdminSignalOverall {
  total: string
  avg_confidence: string
  total_tokens: string
  unique_users: string
}

export interface SupportTicket {
  id: string
  user_id: string
  title: string
  description: string
  category: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  status: 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed'
  user_email: string
  user_name: string
  created_at: string
  assigned_to: string | null
  resolved_at: string | null
  resolution_notes: string | null
}

export interface SystemAlert {
  id: string
  alert_type: string
  severity: 'info' | 'warning' | 'critical'
  message: string
  status: string
  created_at: string
}

export interface SystemHealth {
  status: string
  timestamp: string
  metrics: {
    active_users: number
    active_subscriptions: number
    open_support_tickets: number
    connected_brokers: number
  }
  recent_errors: Array<{
    action: string
    entity_type: string
    error_message: string
    created_at: string
  }>
}

export interface AutoTradingSettings {
  enabled: boolean
  broker_connection_id: string | null
  symbols: string[]
  timeframes: string[]
  min_confidence: number
  risk_per_trade_pct: number
  max_daily_loss_pct: number
  cooldown_minutes: number
  max_trades_per_day: number
}

export interface AutoTradingRun {
  id: string
  symbol: string
  timeframe: string
  decision: string | null
  confidence: number | null
  action: string
  signal_id: string | null
  order_id: string | null
  reasoning: string | null
  error_message: string | null
  created_at: string
}

export interface AutoTradingStatus {
  enabled: boolean
  last_run_at: string | null
  trades_today: number
  todays_pnl: number
}
