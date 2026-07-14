import { render, screen } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { AnalysisChart } from './AnalysisChart'
import type { Candle, Signal } from '@/types/api'

const setData = vi.fn()
const update = vi.fn()
const createPriceLine = vi.fn()
const removeSeries = vi.fn()
const addSeries = vi.fn(() => ({ setData, update, createPriceLine, applyOptions: vi.fn() }))
const chartApi = {
  addSeries,
  removeSeries,
  remove: vi.fn(),
  applyOptions: vi.fn(),
  priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
  timeScale: vi.fn(() => ({ fitContent: vi.fn(), subscribeVisibleLogicalRangeChange: vi.fn(), unsubscribeVisibleLogicalRangeChange: vi.fn() })),
  subscribeCrosshairMove: vi.fn(),
}

vi.mock('lightweight-charts', () => ({
  createChart: vi.fn(() => chartApi),
  CandlestickSeries: 'CandlestickSeries',
  HistogramSeries: 'HistogramSeries',
  LineSeries: 'LineSeries',
  ColorType: { Solid: 'solid' },
  LineStyle: { Dashed: 2, Solid: 0 },
}))

function candle(i: number): Candle {
  return { time: new Date(1760000000000 + i * 3600000).toISOString(), open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 1000 }
}
const candles = Array.from({ length: 60 }, (_, i) => candle(i))

const signal: Signal = {
  id: 'sig-1', symbol: 'AAPL', signal_type: 'buy', confidence: 82,
  entry_price: 150, stop_loss: 145, take_profit: 160,
}

beforeEach(() => vi.clearAllMocks())

describe('AnalysisChart', () => {
  test('creates candlestick + volume series and feeds candle data', () => {
    render(<AnalysisChart candles={candles} indicators={[]} />)
    expect(screen.getByTestId('analysis-chart')).toBeInTheDocument()
    const kinds = addSeries.mock.calls.map((c) => c[0])
    expect(kinds).toContain('CandlestickSeries')
    expect(kinds).toContain('HistogramSeries') // volume
    expect(setData).toHaveBeenCalled()
  })

  test('adds a line series per visible overlay instance and skips hidden ones', () => {
    render(
      <AnalysisChart
        candles={candles}
        indicators={[
          { id: 'sma-20', kind: 'sma', params: { period: 20 }, visible: true },
          { id: 'sma-50', kind: 'sma', params: { period: 50 }, visible: false },
        ]}
      />,
    )
    const lineCalls = addSeries.mock.calls.filter((c) => c[0] === 'LineSeries')
    expect(lineCalls).toHaveLength(1)
  })

  test('pane indicators get a pane index > 0', () => {
    render(
      <AnalysisChart
        candles={candles}
        indicators={[{ id: 'rsi-14', kind: 'rsi', params: { period: 14 }, visible: true }]}
      />,
    )
    const rsiCall = addSeries.mock.calls.find((c) => c[0] === 'LineSeries' && (c[2] ?? 0) > 0)
    expect(rsiCall).toBeTruthy()
  })

  test('draws entry/stop/take-profit price lines for the signal', () => {
    render(<AnalysisChart candles={candles} indicators={[]} signal={signal} />)
    expect(createPriceLine).toHaveBeenCalledTimes(3)
    const prices = createPriceLine.mock.calls.map((c) => c[0].price)
    expect(prices).toEqual(expect.arrayContaining([150, 145, 160]))
  })

  test('coerces string-typed signal prices to numbers (API serializes numerics as strings)', () => {
    const stringSignal = { ...signal, entry_price: '150.5', stop_loss: '145.25', take_profit: '160.75' } as unknown as Signal
    render(<AnalysisChart candles={candles} indicators={[]} signal={stringSignal} />)
    expect(createPriceLine).toHaveBeenCalledTimes(3)
    for (const call of createPriceLine.mock.calls) {
      expect(typeof call[0].price).toBe('number')
    }
    const prices = createPriceLine.mock.calls.map((c) => c[0].price)
    expect(prices).toEqual(expect.arrayContaining([150.5, 145.25, 160.75]))
  })

  test('showSignal=false draws no price lines', () => {
    render(<AnalysisChart candles={candles} indicators={[]} signal={signal} showSignal={false} />)
    expect(createPriceLine).not.toHaveBeenCalled()
  })
})
