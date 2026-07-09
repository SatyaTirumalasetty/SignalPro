import { useEffect, useRef } from 'react'
import { ColorType, LineSeries, createChart, type UTCTimestamp } from 'lightweight-charts'
import type { BenchmarkPoint } from '@/types/api'

export function BenchmarkChart({ series }: { series: BenchmarkPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: '#262932' },
        horzLines: { color: '#262932' },
      },
      width: containerRef.current.clientWidth,
      height: 280,
      timeScale: { timeVisible: false },
    })

    const toPoint = (date: string, value: number) => ({
      time: (new Date(`${date}T00:00:00Z`).getTime() / 1000) as UTCTimestamp,
      value,
    })

    const engine = chart.addSeries(LineSeries, { color: '#22c55e', lineWidth: 2, title: 'Engine' })
    engine.setData(series.map((p) => toPoint(p.date, p.engine_equity)))

    const benchmark = chart.addSeries(LineSeries, { color: '#9ca3af', lineWidth: 2, title: 'Buy & hold' })
    benchmark.setData(series.map((p) => toPoint(p.date, p.watchlist_value)))

    chart.timeScale().fitContent()

    const handleResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth })
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [series])

  return <div ref={containerRef} className="w-full" />
}
