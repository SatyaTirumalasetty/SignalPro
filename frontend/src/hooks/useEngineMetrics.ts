import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { EngineMetrics } from '@/types/api'

export function useEngineMetrics() {
  return useQuery({
    queryKey: ['engine-metrics'],
    queryFn: async () => (await api.get<EngineMetrics>('/auto-trading/metrics')).data,
    refetchInterval: 60_000,
  })
}
