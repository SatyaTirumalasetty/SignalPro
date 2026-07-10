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

// Simple-average RSI over a fixed window — matches backend rsi()
export function rsiSeries(closes: number[], period = 14): SeriesPoint[] {
  return closes.map((_, i) => {
    if (i < period) return null
    let gains = 0
    let losses = 0
    for (let j = i - period + 1; j <= i; j++) {
      const change = closes[j] - closes[j - 1]
      if (change > 0) gains += change
      else losses -= change
    }
    const avgLoss = losses / period
    if (avgLoss === 0) return 100
    const rs = gains / period / avgLoss
    return 100 - 100 / (1 + rs)
  })
}

// EMA over an array that may contain leading nulls (used for the MACD signal line)
function emaOverValid(values: SeriesPoint[], period: number): SeriesPoint[] {
  const firstIdx = values.findIndex((v) => v !== null)
  if (firstIdx === -1) return values.map(() => null)
  const valid = values.slice(firstIdx) as number[]
  if (valid.length < period) return values.map(() => null)
  const k = 2 / (period + 1)
  const out: SeriesPoint[] = new Array(firstIdx + period - 1).fill(null)
  let val = valid.slice(0, period).reduce((a, b) => a + b, 0) / period
  out.push(val)
  for (let i = period; i < valid.length; i++) {
    val = valid[i] * k + val * (1 - k)
    out.push(val)
  }
  return out
}

export function macdSeries(closes: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = emaOverValid(closes.map((c) => c), fast)
  const emaSlow = emaOverValid(closes.map((c) => c), slow)
  const macd = closes.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null ? emaFast[i]! - emaSlow[i]! : null,
  )
  const signalLine = emaOverValid(macd, signal)
  const histogram = macd.map((m, i) =>
    m !== null && signalLine[i] !== null ? m - signalLine[i]! : null,
  )
  return { macd, signal: signalLine, histogram }
}

export function stochasticSeries(candles: Candle[], kPeriod = 14, dPeriod = 3) {
  const k: SeriesPoint[] = candles.map((c, i) => {
    if (i < kPeriod - 1) return null
    const slice = candles.slice(i - kPeriod + 1, i + 1)
    const highMax = Math.max(...slice.map((x) => x.high))
    const lowMin = Math.min(...slice.map((x) => x.low))
    if (highMax === lowMin) return 50
    return ((c.close - lowMin) / (highMax - lowMin)) * 100
  })
  const d: SeriesPoint[] = k.map((_, i) => {
    if (i < kPeriod - 1 + dPeriod - 1) return null
    const window = k.slice(i - dPeriod + 1, i + 1)
    if (window.some((v) => v === null)) return null
    return (window as number[]).reduce((a, b) => a + b, 0) / dPeriod
  })
  return { k, d }
}

export function obvSeries(candles: Candle[]): SeriesPoint[] {
  let obv = 0
  return candles.map((c, i) => {
    if (i === 0) return 0
    const prev = candles[i - 1]
    if (c.close > prev.close) obv += c.volume ?? 0
    else if (c.close < prev.close) obv -= c.volume ?? 0
    return obv
  })
}
