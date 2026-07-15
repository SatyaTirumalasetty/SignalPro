import { describe, test, expect } from 'vitest'
import fixture from './__fixtures__/parity.json'
import { rsiSeries, macdSeries, stochasticSeries, atrSeries, obvSeries } from './panes'
import type { Candle } from '@/types/api'

const candles = fixture.candles as Candle[]
const closes = candles.map((c) => c.close)
const last = <T,>(arr: T[]) => arr[arr.length - 1]
const round4 = (v: number | null) => (v === null ? null : parseFloat(v.toFixed(4)))
const round2 = (v: number | null) => (v === null ? null : parseFloat(v.toFixed(2)))

describe('parity with backend indicators.js', () => {
  test('rsi_14', () => {
    expect(round4(last(rsiSeries(closes, 14)))).toBe(fixture.expected.rsi_14)
  })
  test('macd 12/26/9', () => {
    const m = macdSeries(closes, 12, 26, 9)
    expect(round4(last(m.macd))).toBe(fixture.expected.macd.macd)
    expect(round4(last(m.signal))).toBe(fixture.expected.macd.signal)
    expect(round4(last(m.histogram))).toBe(fixture.expected.macd.histogram)
  })
  test('atr_14', () => {
    expect(round4(last(atrSeries(candles, 14)))).toBe(fixture.expected.atr_14)
  })
  test('stochastic %K', () => {
    const s = stochasticSeries(candles, 14, 3)
    expect(round2(last(s.k))).toBe(fixture.expected.stochastic.k)
  })
})

describe('pane-only indicators', () => {
  test('rsi stays within 0-100', () => {
    const r = rsiSeries(closes, 14).filter((v): v is number => v !== null)
    expect(Math.min(...r)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...r)).toBeLessThanOrEqual(100)
  })
  test('%D is the smoothed %K', () => {
    const s = stochasticSeries(candles, 14, 3)
    const i = candles.length - 1
    const manual = (s.k[i]! + s.k[i - 1]! + s.k[i - 2]!) / 3
    expect(s.d[i]).toBeCloseTo(manual, 8)
  })
  test('obv is cumulative and length-aligned', () => {
    const o = obvSeries(candles)
    expect(o).toHaveLength(candles.length)
    expect(o[0]).toBe(0)
    expect(typeof last(o)).toBe('number')
  })
})
