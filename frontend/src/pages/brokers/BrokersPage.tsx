import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plug, RefreshCw, CheckCircle2, Trash2, Pencil } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog } from '@/components/ui/dialog'
import { useToast } from '@/hooks/useToast'
import { api, getApiErrorMessage } from '@/lib/api'
import { formatDate } from '@/lib/format'
import type { BrokerConnection, CredentialField, SupportedBroker } from '@/types/api'

const statusVariant: Record<string, 'success' | 'danger' | 'muted' | 'default'> = {
  connected: 'success',
  disconnected: 'muted',
  error: 'danger',
  pending: 'default',
}

export function BrokersPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [connectBroker, setConnectBroker] = useState<SupportedBroker | null>(null)
  const [renaming, setRenaming] = useState<BrokerConnection | null>(null)

  const supportedQuery = useQuery({
    queryKey: ['brokers-supported'],
    queryFn: async () => (await api.get<{ brokers: SupportedBroker[] }>('/brokers/supported')).data.brokers,
  })

  const connectionsQuery = useQuery({
    queryKey: ['broker-connections'],
    queryFn: async () => (await api.get<{ connections: BrokerConnection[] }>('/brokers/connections')).data.connections,
  })

  const syncMutation = useMutation({
    mutationFn: (id: string) => api.post(`/brokers/connections/${id}/sync`),
    onSuccess: () => {
      toast('Sync started', 'success')
      queryClient.invalidateQueries({ queryKey: ['broker-connections'] })
    },
    onError: (err) => toast(getApiErrorMessage(err), 'error'),
  })

  const testMutation = useMutation({
    mutationFn: (id: string) => api.post<{ status: string; details?: unknown; error?: string }>(`/brokers/connections/${id}/test`),
    onSuccess: (res) => {
      const data = res.data
      if (data.status === 'ok') toast('Connection test succeeded', 'success')
      else toast(data.error || 'Connection test failed', 'error')
    },
    onError: (err) => toast(getApiErrorMessage(err), 'error'),
  })

  const disconnectMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/brokers/connections/${id}`),
    onSuccess: () => {
      toast('Broker disconnected', 'success')
      queryClient.invalidateQueries({ queryKey: ['broker-connections'] })
    },
    onError: (err) => toast(getApiErrorMessage(err), 'error'),
  })

  const connections = connectionsQuery.data ?? []
  const connectedBrokerIds = new Set(connections.filter((c) => c.status !== 'disconnected').map((c) => c.broker_id))

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Broker connections</h1>
        <p className="text-sm text-muted">Connect your brokerage accounts to sync orders and positions</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your connections</CardTitle>
        </CardHeader>
        <CardContent>
          {connectionsQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}
          {connections.length === 0 && !connectionsQuery.isLoading && (
            <p className="text-sm text-muted">No broker connections yet. Connect one below to get started.</p>
          )}
          {connections.length > 0 && (
            <div className="flex flex-col gap-3">
              {connections.map((conn) => (
                <div
                  key={conn.id}
                  className="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{conn.name}</span>
                      <Badge variant={statusVariant[conn.status?.toLowerCase()] ?? 'muted'}>{conn.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {conn.broker_id} · connected {formatDate(conn.connected_at)}
                      {conn.last_sync ? ` · last sync ${formatDate(conn.last_sync)}` : ''}
                    </p>
                    {conn.sync_error && <p className="mt-1 text-xs text-danger">Sync error: {conn.sync_error}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {conn.status === 'connected' && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => testMutation.mutate(conn.id)}
                          disabled={testMutation.isPending}
                        >
                          <CheckCircle2 size={14} />
                          Test
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => syncMutation.mutate(conn.id)}
                          disabled={syncMutation.isPending}
                        >
                          <RefreshCw size={14} />
                          Sync
                        </Button>
                      </>
                    )}
                    <Button size="sm" variant="outline" onClick={() => setRenaming(conn)}>
                      <Pencil size={14} />
                      Rename
                    </Button>
                    {conn.status !== 'disconnected' && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => disconnectMutation.mutate(conn.id)}
                        disabled={disconnectMutation.isPending}
                      >
                        <Trash2 size={14} />
                        Disconnect
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Available brokers</CardTitle>
        </CardHeader>
        <CardContent>
          {supportedQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {supportedQuery.data?.map((broker) => (
              <div key={broker.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">{broker.name}</span>
                  {connectedBrokerIds.has(broker.id) && <Badge variant="success">Connected</Badge>}
                </div>
                {broker.description && <p className="text-xs text-muted">{broker.description}</p>}
                {!!broker.markets?.length && (
                  <p className="text-xs text-muted">Markets: {broker.markets.join(', ')}</p>
                )}
                <Button size="sm" variant="outline" className="mt-1 self-start" onClick={() => setConnectBroker(broker)}>
                  <Plug size={14} />
                  Connect
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <ConnectBrokerDialog broker={connectBroker} onClose={() => setConnectBroker(null)} />
      <RenameConnectionDialog key={renaming?.id ?? 'none'} connection={renaming} onClose={() => setRenaming(null)} />
    </div>
  )
}

function ConnectBrokerDialog({ broker, onClose }: { broker: SupportedBroker | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [values, setValues] = useState<Record<string, string>>({})
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const fields: CredentialField[] = broker?.credential_fields ?? []
  const isOAuth = broker?.auth_type === 'oauth' || broker?.oauth_required

  const reset = () => {
    setValues({})
    setName('')
    setError(null)
    setSubmitting(false)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const connectMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/brokers/connect', payload),
    onSuccess: () => {
      toast('Broker connected', 'success')
      queryClient.invalidateQueries({ queryKey: ['broker-connections'] })
      handleClose()
    },
    onError: (err) => {
      setError(getApiErrorMessage(err))
      setSubmitting(false)
    },
  })

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!broker) return
    setError(null)

    if (isOAuth) {
      setSubmitting(true)
      try {
        const res = await api.get<{ url: string }>(`/brokers/${broker.id}/oauth/url`, {
          params: { ...values, name: name || undefined },
        })
        window.location.href = res.data.url
      } catch (err) {
        setError(getApiErrorMessage(err))
        setSubmitting(false)
      }
      return
    }

    setSubmitting(true)
    connectMutation.mutate({ broker_id: broker.id, credentials: values, name: name || undefined })
  }

  return (
    <Dialog open={!!broker} onClose={handleClose} title={broker ? `Connect ${broker.name}` : 'Connect broker'}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Input placeholder="Connection name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        {fields.map((field) => (
          <div key={field.key} className="flex flex-col gap-1">
            <Input
              type={field.type === 'password' ? 'password' : 'text'}
              placeholder={`${field.label}${field.required ? ' *' : ''}`}
              value={values[field.key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
              required={field.required}
            />
            {field.note && <p className="text-xs text-muted">{field.note}</p>}
          </div>
        ))}
        {isOAuth && (
          <p className="text-xs text-muted">
            You&apos;ll be redirected to {broker?.name} to authorize access, then sent back here.
          </p>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Connecting…' : isOAuth ? 'Continue to authorize' : 'Connect'}
        </Button>
      </form>
    </Dialog>
  )
}

function RenameConnectionDialog({ connection, onClose }: { connection: BrokerConnection | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [name, setName] = useState(connection?.name ?? '')
  const [error, setError] = useState<string | null>(null)

  const renameMutation = useMutation({
    mutationFn: (payload: { id: string; name: string }) => api.put(`/brokers/connections/${payload.id}`, { name: payload.name }),
    onSuccess: () => {
      toast('Connection renamed', 'success')
      queryClient.invalidateQueries({ queryKey: ['broker-connections'] })
      setError(null)
      onClose()
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!connection) return
    setError(null)
    renameMutation.mutate({ id: connection.id, name })
  }

  return (
    <Dialog
      open={!!connection}
      onClose={() => {
        setError(null)
        onClose()
      }}
      title="Rename connection"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Input
          placeholder="Connection name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={renameMutation.isPending}>
          {renameMutation.isPending ? 'Saving…' : 'Save'}
        </Button>
      </form>
    </Dialog>
  )
}
