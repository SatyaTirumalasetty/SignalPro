import { describe, test, expect } from 'vitest'
import fixture from './__fixtures__/parity.json'
import { smaSeries, emaSeries, wmaSeries, bollingerSeries, vwapSeries, keltnerSeries, psarSeries, supertrendSeries } from './overlays'
import type { Candle } from '@/types/api'

const candles = fixture.candles as Candle[]
const closes = candles.map((c) => c.close)
const last = <T,>(arr: T[]) => arr[arr.length - 1]
const round4 = (v: number | null) => (v === null ? null : parseFloat(v.toFixed(4)))
const round2 = (v: number | null) => (v === null ? null : parseFloat(v.toFixed(2)))

describe('series shape', () => {
  test('output length equals input length with leading nulls', () => {
    const s = smaSeries(closes, 20)
    expect(s).toHaveLength(closes.length)
    expect(s.slice(0, 19).every((v) => v === null)).toBe(true)
    expect(s[19]).not.toBeNull()
  })

  test('window larger than data yields all nulls', () => {
    expect(smaSeries(closes.slice(0, 5), 20).every((v) => v === null)).toBe(true)
  })
})

describe('parity with backend indicators.js', () => {
  test('sma_20 / sma_50', () => {
    expect(round4(last(smaSeries(closes, 20)))).toBe(fixture.expected.sma_20)
    expect(round4(last(smaSeries(closes, 50)))).toBe(fixture.expected.sma_50)
  })
  test('ema_12 / ema_26', () => {
    expect(round4(last(emaSeries(closes, 12)))).toBe(fixture.expected.ema_12)
    expect(round4(last(emaSeries(closes, 26)))).toBe(fixture.expected.ema_26)
  })
  test('bollinger 20/2', () => {
    const bb = bollingerSeries(closes, 20, 2)
    expect(round2(last(bb.upper))).toBe(fixture.expected.bollinger_bands.upper)
    expect(round2(last(bb.middle))).toBe(fixture.expected.bollinger_bands.middle)
    expect(round2(last(bb.lower))).toBe(fixture.expected.bollinger_bands.lower)
  })
  test('vwap', () => {
    expect(round4(last(vwapSeries(candles)))).toBe(fixture.expected.vwap)
  })
})

describe('overlay-only indicators (sanity, no backend twin)', () => {
  test('wma reacts faster than sma', () => {
    const w = last(wmaSeries(closes, 20))!
    const s = last(smaSeries(closes, 20))!
    expect(typeof w).toBe('number')
    expect(w).not.toBe(s)
  })
  test('keltner produces ordered bands', () => {
    const k = keltnerSeries(candles)
    const i = candles.length - 1
    expect(k.upper[i]!).toBeGreaterThan(k.middle[i]!)
    expect(k.lower[i]!).toBeLessThan(k.middle[i]!)
  })
  test('psar stays within recent price range', () => {
    const p = last(psarSeries(candles))!
    const highs = Math.max(...candles.slice(-50).map((c) => c.high))
    const lows = Math.min(...candles.slice(-50).map((c) => c.low))
    expect(p).toBeGreaterThan(lows * 0.9)
    expect(p).toBeLessThan(highs * 1.1)
  })
  test('supertrend emits a numeric line once warmed up', () => {
    const st = supertrendSeries(candles)
    expect(st).toHaveLength(candles.length)
    expect(typeof last(st)).toBe('number')
  })
})
