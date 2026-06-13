import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/useToast'
import { api, getApiErrorMessage } from '@/lib/api'
import { formatCurrency, formatDate, formatNumber, formatPercent } from '@/lib/format'
import type { Position } from '@/types/api'

export function PositionsPage() {
  const [tab, setTab] = useState<'open' | 'closed'>('open')
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const positionsQuery = useQuery({
    queryKey: ['positions', tab],
    queryFn: async () =>
      (await api.get<{ positions: Position[] }>('/trading/positions', { params: { status: tab } })).data.positions,
  })

  const closeMutation = useMutation({
    mutationFn: (positionId: string) => api.post(`/trading/positions/${positionId}/close`),
    onSuccess: () => {
      toast('Position closed', 'success')
      queryClient.invalidateQueries({ queryKey: ['positions'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio'] })
    },
    onError: (err) => toast(getApiErrorMessage(err), 'error'),
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Positions</h1>
        <p className="text-sm text-muted">Track your open and closed positions</p>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as 'open' | 'closed')}>
        <TabsList>
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="closed">Closed</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle>{tab === 'open' ? 'Open positions' : 'Closed positions'}</CardTitle>
        </CardHeader>
        <CardContent>
          {positionsQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}
          {positionsQuery.data?.length === 0 && <p className="text-sm text-muted">No {tab} positions.</p>}
          {!!positionsQuery.data?.length && (
            <Table>
              <TableHeader sticky>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Entry</TableHead>
                  <TableHead>Current</TableHead>
                  <TableHead>P&amp;L</TableHead>
                  <TableHead>Opened</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {positionsQuery.data.map((position) => (
                  <TableRow key={position.id}>
                    <TableCell className="font-medium text-foreground">{position.symbol}</TableCell>
                    <TableCell>
                      <Badge variant={position.position_type === 'long' ? 'success' : 'danger'}>
                        {position.position_type}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatNumber(position.quantity)}</TableCell>
                    <TableCell>{formatCurrency(position.entry_price)}</TableCell>
                    <TableCell>{formatCurrency(position.current_price)}</TableCell>
                    <TableCell className={(position.pnl ?? 0) >= 0 ? 'text-success' : 'text-danger'}>
                      {formatCurrency(position.pnl)} ({formatPercent(position.pnl_percent)})
                    </TableCell>
                    <TableCell className="text-muted">{formatDate(position.opened_at)}</TableCell>
                    <TableCell>
                      {tab === 'open' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => closeMutation.mutate(position.id)}
                          disabled={closeMutation.isPending}
                        >
                          Close
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
