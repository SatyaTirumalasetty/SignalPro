import { describe, test, expect } from 'vitest'
import { sizeByRisk } from './positionSize'

describe('sizeByRisk', () => {
  test('risk-based quantity, capped by affordability', () => {
    // 100000 * 1% = 1000 risk; per-unit 5 -> 200; affordable floor(100000/150)=666 -> 200
    expect(sizeByRisk({ equity: 100000, riskPct: 0.01, entry: 150, stop: 145 })).toBe(200)
  })
  test('affordability cap wins when risk allows more', () => {
    // risk qty 10000, affordable 66
    expect(sizeByRisk({ equity: 10000, riskPct: 1, entry: 150, stop: 149 })).toBe(66)
  })
  test('zero on degenerate inputs', () => {
    expect(sizeByRisk({ equity: 0, riskPct: 0.01, entry: 150, stop: 145 })).toBe(0)
    expect(sizeByRisk({ equity: 100000, riskPct: 0.01, entry: 150, stop: 150 })).toBe(0)
    expect(sizeByRisk({ equity: 100000, riskPct: 0.01, entry: 0, stop: -5 })).toBe(0)
  })
})
