// Price-overlay indicator series. Every function returns an array aligned
// 1:1 with its input (ascending time), null where the window is unfilled.
// Parity-tested against backend/src/services/indicators.js via parity.json.
import type { Candle } from '@/types/api'
import type { SeriesPoint } from './types'
import { atrSeries } from './panes'

export function smaSeries(closes: number[], period: number): SeriesPoint[] {
  return closes.map((_, i) => {
    if (i < period - 1) return null
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += closes[j]
    return sum / period
  })
}

// Seeded with the SMA of the first `period` closes — matches backend emaArray()
export function emaSeries(closes: number[], period: number): SeriesPoint[] {
  if (closes.length < period) return closes.map(() => null)
  const k = 2 / (period + 1)
  const out: SeriesPoint[] = new Array(period - 1).fill(null)
  let val = closes.slice(0, period).reduce((a, b) => a + b, 0) / period
  out.push(val)
  for (let i = period; i < closes.length; i++) {
    val = closes[i] * k + val * (1 - k)
    out.push(val)
  }
  return out
}

export function wmaSeries(closes: number[], period: number): SeriesPoint[] {
  const denom = (period * (period + 1)) / 2
  return closes.map((_, i) => {
    if (i < period - 1) return null
    let sum = 0
    for (let j = 0; j < period; j++) sum += closes[i - period + 1 + j] * (j + 1)
    return sum / denom
  })
}

export function bollingerSeries(closes: number[], period = 20, mult = 2) {
  const middle = smaSeries(closes, period)
  const upper: SeriesPoint[] = []
  const lower: SeriesPoint[] = []
  closes.forEach((_, i) => {
    const mid = middle[i]
    if (mid === null) { upper.push(null); lower.push(null); return }
    let variance = 0
    for (let j = i - period + 1; j <= i; j++) variance += (closes[j] - mid) ** 2
    const sd = Math.sqrt(variance / period)
    upper.push(mid + mult * sd)
    lower.push(mid - mult * sd)
  })
  return { upper, middle, lower }
}

// Cumulative VWAP over the loaded window — matches backend vwap() at the tail
export function vwapSeries(candles: Candle[]): SeriesPoint[] {
  let cumPV = 0
  let cumV = 0
  return candles.map((c) => {
    if (!c.volume || !c.high || !c.low || !c.close) return cumV ? cumPV / cumV : null
    const tp = (c.high + c.low + c.close) / 3
    cumPV += tp * c.volume
    cumV += c.volume
    return cumPV / cumV
  })
}

export function keltnerSeries(candles: Candle[], emaPeriod = 20, atrPeriod = 10, mult = 2) {
  const middle = emaSeries(candles.map((c) => c.close), emaPeriod)
  const atr = atrSeries(candles, atrPeriod)
  const upper = middle.map((m, i) => (m !== null && atr[i] !== null ? m + mult * atr[i]! : null))
  const lower = middle.map((m, i) => (m !== null && atr[i] !== null ? m - mult * atr[i]! : null))
  return { upper, middle, lower }
}

export function psarSeries(candles: Candle[], step = 0.02, max = 0.2): SeriesPoint[] {
  if (candles.length < 2) return candles.map(() => null)
  const out: SeriesPoint[] = [null]
  let uptrend = candles[1].close >= candles[0].close
  let sar = uptrend ? candles[0].low : candles[0].high
  let ep = uptrend ? candles[0].high : candles[0].low
  let af = step
  for (let i = 1; i < candles.length; i++) {
    sar = sar + af * (ep - sar)
    const c = candles[i]
    if (uptrend) {
      sar = Math.min(sar, candles[i - 1].low, i >= 2 ? candles[i - 2].low : candles[i - 1].low)
      if (c.low < sar) { uptrend = false; sar = ep; ep = c.low; af = step }
      else if (c.high > ep) { ep = c.high; af = Math.min(af + step, max) }
    } else {
      sar = Math.max(sar, candles[i - 1].high, i >= 2 ? candles[i - 2].high : candles[i - 1].high)
      if (c.high > sar) { uptrend = true; sar = ep; ep = c.high; af = step }
      else if (c.low < ep) { ep = c.low; af = Math.min(af + step, max) }
    }
    out.push(sar)
  }
  return out
}

export function supertrendSeries(candles: Candle[], period = 10, mult = 3): SeriesPoint[] {
  const atr = atrSeries(candles, period)
  const out: SeriesPoint[] = []
  let upper: number | null = null
  let lower: number | null = null
  let trendUp = true
  candles.forEach((c, i) => {
    const a = atr[i]
    if (a === null) { out.push(null); return }
    const mid = (c.high + c.low) / 2
    const basicUpper = mid + mult * a
    const basicLower = mid - mult * a
    const prevClose = candles[i - 1]?.close ?? c.close
    upper = upper !== null && (basicUpper > upper && prevClose <= upper) ? upper : basicUpper
    lower = lower !== null && (basicLower < lower && prevClose >= lower) ? lower : basicLower
    if (c.close > (upper ?? Infinity)) trendUp = true
    else if (c.close < (lower ?? -Infinity)) trendUp = false
    out.push(trendUp ? lower : upper)
  })
  return out
}
