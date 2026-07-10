import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { DEFAULT_LAYOUT, type IndicatorConfig } from '@/lib/indicators/types'

interface MeResponse { user: { preferences?: { chart_layout?: IndicatorConfig[]; [k: string]: unknown } } }

export function useChartLayout() {
  const queryClient = useQueryClient()
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
    if (Array.isArray(saved)) setLayoutState(saved)
  }, [me.data])

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  const setLayout = (next: IndicatorConfig[]) => {
    setLayoutState(next)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      // Preferences is a single jsonb column replaced wholesale on PUT, so we
      // must always merge onto the freshest server-side copy — never the
      // value captured at closure/mount time — or we risk wiping other keys
      // (e.g. auto_trading) that were saved concurrently.
      const fresh = (await api.get<MeResponse>('/users/me')).data.user.preferences ?? {}
      const prefs = { ...fresh, chart_layout: next }
      await api.put('/users/me', { preferences: prefs })
      void queryClient.invalidateQueries({ queryKey: ['me'] })
    }, 800)
  }

  return { layout, setLayout, isLoaded: !me.isLoading }
}
