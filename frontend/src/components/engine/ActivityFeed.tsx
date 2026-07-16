import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { formatDate, formatNumber, signalBadgeVariant } from '@/lib/format'
import type { AutoTradingRun } from '@/types/api'

const ACTION_OPTIONS = [
  { value: 'all', label: 'All actions' },
  { value: 'order_placed', label: 'order_placed' },
  { value: 'position_closed', label: 'position_closed' },
  { value: 'partial_exit', label: 'partial_exit' },
  { value: 'stop_adjusted', label: 'stop_adjusted' },
  { value: 'skipped_low_confidence', label: 'skipped_low_confidence' },
  { value: 'skipped_existing_position', label: 'skipped_existing_position' },
  { value: 'error', label: 'error' },
]

export function ActivityFeed() {
  const [symbol, setSymbol] = useState('')
  const [action, setAction] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  const params: Record<string, string | number> = { limit: 50 }
  if (symbol.trim()) params.symbol = symbol.trim().toUpperCase()
  if (action && action !== 'all') params.action = action

  const { data, isLoading } = useQuery({
    queryKey: ['engine-activity', params.symbol ?? '', params.action ?? ''],
    queryFn: async () => (await api.get<{ runs: AutoTradingRun[]; total: number }>('/auto-trading/activity', { params })).data,
    refetchInterval: 60_000,
  })
  const runs = data?.runs ?? []

  return (
    <Card>
      <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Input placeholder="Filter symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} className="w-40" />
          <Select value={action} onValueChange={setAction} options={ACTION_OPTIONS} placeholder="All actions" />
        </div>
        {isLoading && <p className="text-sm text-muted">Loading…</p>}
        {!isLoading && runs.length === 0 && <p className="text-sm text-muted">No matching activity.</p>}
        {runs.length > 0 && (
          <Table>
            <TableHeader sticky>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Decision</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <React.Fragment key={run.id}>
                  <TableRow onClick={() => setExpanded(expanded === run.id ? null : run.id)} className="cursor-pointer">
                    <TableCell className="text-muted">{formatDate(run.created_at)}</TableCell>
                    <TableCell className="font-medium text-foreground">{run.symbol}</TableCell>
                    <TableCell>{run.decision ? <Badge variant={signalBadgeVariant(run.decision)}>{run.decision}</Badge> : '—'}</TableCell>
                    <TableCell>{run.confidence != null ? `${formatNumber(run.confidence, 0)}%` : '—'}</TableCell>
                    <TableCell><Badge variant="muted">{run.action}</Badge></TableCell>
                  </TableRow>
                  {expanded === run.id && (
                    <TableRow>
                      <TableCell colSpan={5} className="bg-card/40">
                        <div className="flex flex-col gap-2 p-2 text-sm">
                          <p className="text-muted">{run.reasoning || run.error_message || 'No reasoning recorded.'}</p>
                          {run.action_detail?.decision?.timeframe_alignment && (
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(run.action_detail.decision.timeframe_alignment).map(([tf, bias]) => (
                                <Badge key={tf} variant={bias === 'bullish' ? 'success' : bias === 'bearish' ? 'danger' : 'muted'}>{tf} {bias}</Badge>
                              ))}
                            </div>
                          )}
                          {run.action_detail?.execution && (
                            <pre className="overflow-x-auto rounded bg-background p-2 text-xs text-muted">{JSON.stringify(run.action_detail.execution, null, 2)}</pre>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
