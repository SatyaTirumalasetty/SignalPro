import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { WatchlistResponse } from '@/types/api'

export function useWatchlist() {
  return useQuery({
    queryKey: ['watchlist'],
    queryFn: async () => (await api.get<WatchlistResponse>('/watchlist')).data.symbols,
  })
}

export function useWatchlistMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (symbols: string[]) =>
      (await api.put<WatchlistResponse>('/watchlist', { symbols })).data.symbols,
    onMutate: async (symbols) => {
      await qc.cancelQueries({ queryKey: ['watchlist'] })
      const prev = qc.getQueryData<string[]>(['watchlist'])
      qc.setQueryData(['watchlist'], symbols)
      return { prev }
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['watchlist'], ctx.prev) },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['watchlist'] }) },
  })
}
