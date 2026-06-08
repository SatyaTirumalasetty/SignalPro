import { useEffect, useId, useRef } from 'react'

interface TradingViewChartProps {
  symbol: string
  /** TradingView interval code, e.g. '1', '5', '15', '60', 'D', 'W' */
  interval?: string
  height?: number
}

const SCRIPT_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'

/**
 * Embeds TradingView's free "Advanced Real-Time Chart" widget — gives users
 * full TradingView charting (drawing tools, dozens of indicators, multiple
 * timeframes, symbol comparison) without us having to build or license it.
 * The widget injects its own iframe via a vendor script, so we manage that
 * script's lifecycle directly rather than going through React's render tree.
 */
export function TradingViewChart({ symbol, interval = 'D', height = 520 }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetId = useId()

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    container.innerHTML = `<div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div>`

    const script = document.createElement('script')
    script.type = 'text/javascript'
    script.src = SCRIPT_SRC
    script.async = true
    script.text = JSON.stringify({
      autosize: true,
      symbol: toTradingViewSymbol(symbol),
      interval,
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'en',
      withdateranges: true,
      hide_side_toolbar: false,
      allow_symbol_change: false,
      details: false,
      hotlist: false,
      calendar: false,
      studies: ['STD;MACD', 'STD;RSI', 'STD;Bollinger_Bands'],
      support_host: 'https://www.tradingview.com',
    })
    container.appendChild(script)

    return () => {
      container.innerHTML = ''
    }
  }, [symbol, interval])

  return (
    <div
      key={widgetId}
      ref={containerRef}
      className="tradingview-widget-container w-full overflow-hidden rounded-md"
      style={{ height }}
    />
  )
}

/**
 * The backend returns bare US-equity tickers (e.g. "AAPL"); TradingView's
 * widget resolves those directly to their primary listing, so no exchange
 * prefix is required for the common case. Indices/forex/crypto symbols that
 * already contain ":" (e.g. "NASDAQ:AAPL", "BINANCE:BTCUSDT") pass through.
 */
function toTradingViewSymbol(symbol: string): string {
  return symbol.includes(':') ? symbol : symbol.toUpperCase()
}
