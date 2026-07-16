export type SeriesPoint = number | null

export type OverlayKind = 'sma' | 'ema' | 'wma' | 'bollinger' | 'vwap' | 'keltner' | 'psar' | 'supertrend'
export type PaneKind = 'rsi' | 'macd' | 'stochastic' | 'atr' | 'obv'
export type IndicatorKind = OverlayKind | PaneKind

export interface IndicatorConfig {
  id: string // unique instance id, e.g. 'sma-20-a1b2'
  kind: IndicatorKind
  params: Record<string, number>
  visible: boolean
}

export const PANE_KINDS: PaneKind[] = ['rsi', 'macd', 'stochastic', 'atr', 'obv']

export function isPaneKind(kind: IndicatorKind): kind is PaneKind {
  return (PANE_KINDS as string[]).includes(kind)
}

// Default layout: what the AI itself watches.
export const DEFAULT_LAYOUT: IndicatorConfig[] = [
  { id: 'sma-20', kind: 'sma', params: { period: 20 }, visible: true },
  { id: 'sma-50', kind: 'sma', params: { period: 50 }, visible: true },
  { id: 'sma-200', kind: 'sma', params: { period: 200 }, visible: true },
  { id: 'bb-20', kind: 'bollinger', params: { period: 20, mult: 2 }, visible: true },
  { id: 'vwap', kind: 'vwap', params: {}, visible: true },
  { id: 'rsi-14', kind: 'rsi', params: { period: 14 }, visible: true },
  { id: 'macd-12-26-9', kind: 'macd', params: { fast: 12, slow: 26, signal: 9 }, visible: true },
]

export const DEFAULT_PARAMS: Record<IndicatorKind, Record<string, number>> = {
  sma: { period: 20 },
  ema: { period: 21 },
  wma: { period: 20 },
  bollinger: { period: 20, mult: 2 },
  vwap: {},
  keltner: { emaPeriod: 20, atrPeriod: 10, mult: 2 },
  psar: { step: 0.02, max: 0.2 },
  supertrend: { period: 10, mult: 3 },
  rsi: { period: 14 },
  macd: { fast: 12, slow: 26, signal: 9 },
  stochastic: { kPeriod: 14, dPeriod: 3 },
  atr: { period: 14 },
  obv: {},
}
