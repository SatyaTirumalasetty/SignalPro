// Chart-only renderer: candles + volume, overlay/pane indicators from config,
// AI signal price lines. Page-level chrome (tabs, toggles) lives in the page.
import { useEffect, useRef } from 'react'
import {
  CandlestickSeries, HistogramSeries, LineSeries, ColorType, LineStyle,
  createChart, type IChartApi, type ISeriesApi, type UTCTimestamp,
} from 'lightweight-charts'
import type { Candle, Signal } from '@/types/api'
import { type IndicatorConfig, isPaneKind } from '@/lib/indicators/types'
import { smaSeries, emaSeries, wmaSeries, bollingerSeries, vwapSeries, keltnerSeries, psarSeries, supertrendSeries } from '@/lib/indicators/overlays'
import { rsiSeries, macdSeries, stochasticSeries, atrSeries, obvSeries } from '@/lib/indicators/panes'
import type { SeriesPoint } from '@/lib/indicators/types'

export interface AnalysisChartProps {
  candles: Candle[]
  indicators: IndicatorConfig[]
  signal?: Signal | null
  showSignal?: boolean
  logScale?: boolean
  onReachOldest?: () => void
}

const OVERLAY_COLORS = ['#3b82f6', '#f59e0b', '#a855f7', '#14b8a6', '#f43f5e', '#84cc16']

const toTs = (c: Candle) => (new Date(c.time).getTime() / 1000) as UTCTimestamp

function toLine(candles: Candle[], values: SeriesPoint[]) {
  const out: { time: UTCTimestamp; value: number }[] = []
  values.forEach((v, i) => { if (v !== null) out.push({ time: toTs(candles[i]), value: v }) })
  return out
}

// Every named line an indicator instance produces: [label, values][]
function indicatorLines(cfg: IndicatorConfig, candles: Candle[]): [string, SeriesPoint[]][] {
  const closes = candles.map((c) => c.close)
  const p = cfg.params
  switch (cfg.kind) {
    case 'sma': return [[`SMA ${p.period}`, smaSeries(closes, p.period)]]
    case 'ema': return [[`EMA ${p.period}`, emaSeries(closes, p.period)]]
    case 'wma': return [[`WMA ${p.period}`, wmaSeries(closes, p.period)]]
    case 'bollinger': {
      const b = bollingerSeries(closes, p.period, p.mult)
      return [[`BB upper`, b.upper], [`BB mid`, b.middle], [`BB lower`, b.lower]]
    }
    case 'vwap': return [['VWAP', vwapSeries(candles)]]
    case 'keltner': {
      const k = keltnerSeries(candles, p.emaPeriod, p.atrPeriod, p.mult)
      return [['KC upper', k.upper], ['KC mid', k.middle], ['KC lower', k.lower]]
    }
    case 'psar': return [['PSAR', psarSeries(candles, p.step, p.max)]]
    case 'supertrend': return [['SuperTrend', supertrendSeries(candles, p.period, p.mult)]]
    case 'rsi': return [[`RSI ${p.period}`, rsiSeries(closes, p.period)]]
    case 'macd': {
      const m = macdSeries(closes, p.fast, p.slow, p.signal)
      return [['MACD', m.macd], ['Signal', m.signal], ['Hist', m.histogram]]
    }
    case 'stochastic': {
      const s = stochasticSeries(candles, p.kPeriod, p.dPeriod)
      return [['%K', s.k], ['%D', s.d]]
    }
    case 'atr': return [[`ATR ${p.period}`, atrSeries(candles, p.period)]]
    case 'obv': return [['OBV', obvSeries(candles)]]
  }
}

export function AnalysisChart({ candles, indicators, signal, showSignal = true, logScale = false, onReachOldest }: AnalysisChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const priceSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el || candles.length === 0) return

    const chart = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#9ca3af' },
      grid: { vertLines: { color: '#262932' }, horzLines: { color: '#262932' } },
      width: el.clientWidth,
      height: el.clientHeight || 480,
      rightPriceScale: { mode: logScale ? 1 : 0 },
      timeScale: { timeVisible: true },
    })
    chartRef.current = chart

    // Price + volume (pane 0)
    const price = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e', downColor: '#ef4444', borderVisible: false,
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    })
    priceSeriesRef.current = price
    price.setData(candles.map((c) => ({ time: toTs(c), open: c.open, high: c.high, low: c.low, close: c.close })))

    const volume = chart.addSeries(HistogramSeries, { priceScaleId: 'volume', color: '#3f3f46' })
    volume.setData(candles.map((c) => ({ time: toTs(c), value: c.volume ?? 0, color: c.close >= c.open ? '#16653466' : '#7f1d1d66' })))
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })

    // Indicators: overlays on pane 0, each pane-kind gets its own pane index
    let nextPane = 1
    let colorIdx = 0
    for (const cfg of indicators) {
      if (!cfg.visible) continue
      const pane = isPaneKind(cfg.kind) ? nextPane++ : 0
      for (const [label, values] of indicatorLines(cfg, candles)) {
        const s = chart.addSeries(LineSeries, {
          color: OVERLAY_COLORS[colorIdx++ % OVERLAY_COLORS.length],
          lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: label,
        }, pane)
        s.setData(toLine(candles, values))
      }
    }

    // AI signal price lines
    if (signal && showSignal) {
      const lines: { price?: number; color: string; style: number; title: string }[] = [
        { price: signal.entry_price, color: '#3b82f6', style: LineStyle.Solid, title: 'AI entry' },
        { price: signal.stop_loss, color: '#ef4444', style: LineStyle.Dashed, title: 'AI stop' },
        { price: signal.take_profit, color: '#22c55e', style: LineStyle.Dashed, title: 'AI target' },
      ]
      for (const l of lines) {
        if (l.price == null) continue
        // The API serializes numeric columns as strings; lightweight-charts
        // asserts price must be a number, so coerce and skip non-finite values.
        const p = Number(l.price)
        if (!Number.isFinite(p)) continue
        price.createPriceLine({ price: p, color: l.color, lineStyle: l.style, lineWidth: 1, axisLabelVisible: true, title: l.title })
      }
    }

    // Pan-back: near the left edge, ask for older candles
    const ts = chart.timeScale()
    const onRange = (range: { from: number; to: number } | null) => {
      if (range && range.from < 10) onReachOldest?.()
    }
    ts.subscribeVisibleLogicalRangeChange(onRange)

    const onResize = () => chart.applyOptions({ width: el.clientWidth })
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      ts.unsubscribeVisibleLogicalRangeChange(onRange)
      chart.remove()
      chartRef.current = null
    }
    // Recreate on structural changes; live close updates arrive via the
    // candles array identity change and are cheap at this candle count.
  }, [candles, indicators, signal, showSignal, logScale, onReachOldest])

  return <div ref={containerRef} data-testid="analysis-chart" className="h-full min-h-[480px] w-full" />
}
