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
  status: string
  broker_order_id?: string
  executed_at?: string
  created_at?: string
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
  account_info?: Record<string, unknown>
  last_sync?: string
  connected_at?: string
  token_expires_at?: string
}

export interface SupportedBroker {
  id: string
  name: string
  oauth_required?: boolean
}

export interface ApiError {
  error: string
  errors?: Array<{ field: string; message: string }>
}
