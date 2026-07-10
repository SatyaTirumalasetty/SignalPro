import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { DEFAULT_LAYOUT, type IndicatorConfig } from '@/lib/indicators/types'

interface MeResponse { user: { preferences?: { chart_layout?: IndicatorConfig[]; [k: string]: unknown } } }

export function useChartLayout() {
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get<MeResponse>('/users/me')).data,
    staleTime: 5 * 60_000,
  })

  const [layout, setLayoutState] = useState<IndicatorConfig[]>(DEFAULT_LAYOUT)
  const loadedRef = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (loadedRef.current || !me.data) return
    loadedRef.current = true
    const saved = me.data.user.preferences?.chart_layout
    if (Array.isArray(saved) && saved.length) setLayoutState(saved)
  }, [me.data])

  const setLayout = (next: IndicatorConfig[]) => {
    setLayoutState(next)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const prefs = { ...(me.data?.user.preferences ?? {}), chart_layout: next }
      void api.put('/users/me', { preferences: prefs })
    }, 800)
  }

  return { layout, setLayout, isLoaded: !me.isLoading }
}
