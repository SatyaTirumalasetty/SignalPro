import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/useToast'
import { api, getApiErrorMessage } from '@/lib/api'
import { formatDate, formatNumber } from '@/lib/format'
import type { SystemAlert, SystemHealth } from '@/types/api'

const severityVariant: Record<string, 'success' | 'danger' | 'muted' | 'default'> = {
  info: 'default',
  warning: 'muted',
  critical: 'danger',
}

export function AdminOverviewPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [alertDialogOpen, setAlertDialogOpen] = useState(false)
  const [alertType, setAlertType] = useState('')
  const [severity, setSeverity] = useState<'info' | 'warning' | 'critical'>('info')
  const [message, setMessage] = useState('')

  const healthQuery = useQuery({
    queryKey: ['admin-system-health'],
    queryFn: async () => (await api.get<SystemHealth>('/admin/system/health')).data,
  })

  const alertsQuery = useQuery({
    queryKey: ['admin-system-alerts'],
    queryFn: async () => (await api.get<{ alerts: SystemAlert[] }>('/admin/system/alerts')).data.alerts,
  })

  const createAlertMutation = useMutation({
    mutationFn: (payload: { alert_type: string; severity: string; message: string }) =>
      api.post('/admin/system/alerts', payload),
    onSuccess: () => {
      toast('Alert created', 'success')
      queryClient.invalidateQueries({ queryKey: ['admin-system-alerts'] })
      setAlertDialogOpen(false)
      setAlertType('')
      setSeverity('info')
      setMessage('')
    },
    onError: (err) => toast(getApiErrorMessage(err), 'error'),
  })

  const health = healthQuery.data
  const alerts = alertsQuery.data ?? []

  const metricCards = health
    ? [
        { label: 'Active users', value: health.metrics.active_users },
        { label: 'Active subscriptions', value: health.metrics.active_subscriptions },
        { label: 'Open support tickets', value: health.metrics.open_support_tickets },
        { label: 'Connected brokers', value: health.metrics.connected_brokers },
      ]
    : []

  const handleCreateAlert = (e: FormEvent) => {
    e.preventDefault()
    createAlertMutation.mutate({ alert_type: alertType, severity, message })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Overview</h1>
          <p className="text-sm text-muted">System health, metrics, and alerts</p>
        </div>
        <Button onClick={() => setAlertDialogOpen(true)}>New alert</Button>
      </div>

      {healthQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}

      {!!metricCards.length && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {metricCards.map((m) => (
            <Card key={m.label}>
              <CardHeader>
                <CardTitle>{m.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold text-foreground">{formatNumber(m.value, 0)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Active alerts</CardTitle>
        </CardHeader>
        <CardContent>
          {alertsQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}
          {!alertsQuery.isLoading && alerts.length === 0 && (
            <p className="text-sm text-muted">No active alerts.</p>
          )}
          {!!alerts.length && (
            <Table>
              <TableHeader sticky>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium text-foreground">{a.alert_type}</TableCell>
                    <TableCell>
                      <Badge variant={severityVariant[a.severity] ?? 'default'}>{a.severity}</Badge>
                    </TableCell>
                    <TableCell className="text-muted">{a.message}</TableCell>
                    <TableCell className="text-muted">{a.status}</TableCell>
                    <TableCell className="text-muted">{formatDate(a.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent errors</CardTitle>
        </CardHeader>
        <CardContent>
          {!health?.recent_errors?.length && <p className="text-sm text-muted">No recent errors.</p>}
          {!!health?.recent_errors?.length && (
            <Table>
              <TableHeader sticky>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {health.recent_errors.map((e, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium text-foreground">{e.action}</TableCell>
                    <TableCell className="text-muted">{e.entity_type}</TableCell>
                    <TableCell className="text-danger">{e.error_message}</TableCell>
                    <TableCell className="text-muted">{formatDate(e.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={alertDialogOpen} onClose={() => setAlertDialogOpen(false)} title="Create system alert">
        <form onSubmit={handleCreateAlert} className="flex flex-col gap-3">
          <Input placeholder="Alert type (e.g. broker_outage)" value={alertType} onChange={(e) => setAlertType(e.target.value)} required />
          <Select
            value={severity}
            onValueChange={(value) => setSeverity(value as 'info' | 'warning' | 'critical')}
            options={[
              { value: 'info', label: 'Info' },
              { value: 'warning', label: 'Warning' },
              { value: 'critical', label: 'Critical' },
            ]}
          />
          <Input placeholder="Message" value={message} onChange={(e) => setMessage(e.target.value)} required />
          <Button type="submit" disabled={createAlertMutation.isPending}>
            {createAlertMutation.isPending ? 'Creating…' : 'Create alert'}
          </Button>
        </form>
      </Dialog>
    </div>
  )
}
