import type { Candle } from '@/types/api'
import type { SeriesPoint } from './types'

// True range per candle (index 0 has no previous close -> null)
export function trueRanges(candles: Candle[]): SeriesPoint[] {
  return candles.map((c, i) => {
    if (i === 0) return null
    const prev = candles[i - 1]
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close))
  })
}

// Simple rolling mean of true ranges — matches backend atr()
export function atrSeries(candles: Candle[], period = 14): SeriesPoint[] {
  const trs = trueRanges(candles)
  return trs.map((_, i) => {
    if (i < period) return null
    const window = trs.slice(i - period + 1, i + 1)
    if (window.some((v) => v === null)) return null
    return (window as number[]).reduce((a, b) => a + b, 0) / period
  })
}
