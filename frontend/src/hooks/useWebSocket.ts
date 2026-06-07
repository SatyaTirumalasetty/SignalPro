import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE_URL } from '@/lib/api'

interface PriceUpdate {
  symbol: string
  price?: number
  change?: number
  change_percent?: number
  [key: string]: unknown
}

const WS_URL = API_BASE_URL.replace(/^http/, 'ws')

export function useLivePrices(symbols: string[]) {
  const [prices, setPrices] = useState<Record<string, PriceUpdate>>({})
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttempt = useRef(0)
  const symbolsRef = useRef<string[]>(symbols)
  useEffect(() => {
    symbolsRef.current = symbols
  }, [symbols])

  const subscribe = useCallback((syms: string[]) => {
    if (syms.length === 0) return
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'subscribe', symbols: syms }))
    }
  }, [])

  useEffect(() => {
    let pingInterval: ReturnType<typeof setInterval> | undefined
    let reconnectTimeout: ReturnType<typeof setTimeout> | undefined
    let closedByEffect = false

    const connect = () => {
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws

      ws.onopen = () => {
        reconnectAttempt.current = 0
        if (symbolsRef.current.length) subscribe(symbolsRef.current)
        pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'pong' }))
        }, 30_000)
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'price' && msg.symbol) {
            setPrices((prev) => ({ ...prev, [msg.symbol]: msg }))
          }
        } catch {
          // ignore malformed messages
        }
      }

      ws.onclose = () => {
        if (pingInterval) clearInterval(pingInterval)
        if (closedByEffect) return
        const delay = Math.min(1000 * 2 ** reconnectAttempt.current, 30_000)
        reconnectAttempt.current += 1
        reconnectTimeout = setTimeout(connect, delay)
      }

      ws.onerror = () => ws.close()
    }

    connect()

    return () => {
      closedByEffect = true
      if (pingInterval) clearInterval(pingInterval)
      if (reconnectTimeout) clearTimeout(reconnectTimeout)
      wsRef.current?.close()
    }
  }, [subscribe])

  useEffect(() => {
    subscribe(symbols)
    return () => {
      if (wsRef.current?.readyState === WebSocket.OPEN && symbols.length) {
        wsRef.current.send(JSON.stringify({ type: 'unsubscribe', symbols }))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.join(',')])

  return prices
}
