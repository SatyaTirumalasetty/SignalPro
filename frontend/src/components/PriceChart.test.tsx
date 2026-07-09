import { render } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
import { PriceChart } from './PriceChart'
import type { Candle } from '@/types/api'

const setDataMock = vi.fn()
const fitContentMock = vi.fn()
const applyOptionsMock = vi.fn()
const removeMock = vi.fn()
const addSeriesMock = vi.fn(() => ({ setData: setDataMock }))

vi.mock('lightweight-charts', () => ({
  ColorType: { Solid: 'solid' },
  CandlestickSeries: 'candlestick-series',
  createChart: vi.fn(() => ({
    addSeries: addSeriesMock,
    timeScale: () => ({ fitContent: fitContentMock }),
    applyOptions: applyOptionsMock,
    remove: removeMock,
  })),
}))

const candles: Candle[] = [
  { time: '2026-06-01T00:00:00.000Z', open: 100, high: 110, low: 95, close: 105 },
  { time: '2026-06-02T00:00:00.000Z', open: 105, high: 115, low: 100, close: 112 },
]

describe('PriceChart', () => {
  test('creates a chart, sets candle data, and fits content', () => {
    const { unmount } = render(<PriceChart candles={candles} />)

    expect(addSeriesMock).toHaveBeenCalled()
    expect(setDataMock).toHaveBeenCalledWith([
      { time: 1780272000, open: 100, high: 110, low: 95, close: 105 },
      { time: 1780358400, open: 105, high: 115, low: 100, close: 112 },
    ])
    expect(fitContentMock).toHaveBeenCalled()

    unmount()
    expect(removeMock).toHaveBeenCalled()
  })
})
