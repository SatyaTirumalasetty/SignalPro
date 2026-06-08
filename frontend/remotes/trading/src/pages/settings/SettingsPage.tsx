import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, KeyRound, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@shared/components/ui/card'
import { Button } from '@shared/components/ui/button'
import { Input } from '@shared/components/ui/input'
import { Badge } from '@shared/components/ui/badge'
import { Dialog } from '@shared/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/components/ui/table'
import { useAuth } from '@shared/hooks/useAuth'
import { useToast } from '@shared/hooks/useToast'
import { api, getApiErrorMessage } from '@shared/lib/api'
import { formatDate } from '@shared/lib/format'
import type { ApiKey, ApiKeyCreateResponse, Session, TwoFaSetupResponse } from '@shared/types/api'

export function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Account settings</h1>
        <p className="text-sm text-muted">Manage your profile, security, sessions, and API access</p>
      </div>

      <ProfileSection />
      <PasswordSection />
      <TwoFactorSection />
      <SessionsSection />
      <ApiKeysSection />
    </div>
  )
}

// ── Profile ────────────────────────────────────────────────────────────────

function ProfileSection() {
  const { user, refreshUser } = useAuth()
  const { toast } = useToast()
  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [country, setCountry] = useState(user?.country ?? '')
  const [error, setError] = useState<string | null>(null)

  const updateMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.put('/users/me', payload),
    onSuccess: async () => {
      toast('Profile updated', 'success')
      setError(null)
      await refreshUser()
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    updateMutation.mutate({
      full_name: fullName,
      phone: phone || undefined,
      country: country ? country.toUpperCase() : undefined,
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">Email</label>
            <Input value={user?.email ?? ''} disabled />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">Full name</label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">Phone</label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 0100" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">Country (ISO code)</label>
            <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="US" maxLength={2} />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" className="self-start" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

// ── Password ───────────────────────────────────────────────────────────────

function PasswordSection() {
  const { toast } = useToast()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const changeMutation = useMutation({
    mutationFn: (payload: { current_password: string; new_password: string }) => api.put('/users/me/password', payload),
    onSuccess: () => {
      toast('Password changed. Please log in again.', 'success')
      setCurrentPassword('')
      setNewPassword('')
      setError(null)
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    changeMutation.mutate({ current_password: currentPassword, new_password: newPassword })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-3">
          <Input
            type="password"
            placeholder="Current password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
          <Input
            type="password"
            placeholder="New password (min. 8 characters)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={8}
            required
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" className="self-start" disabled={changeMutation.isPending}>
            {changeMutation.isPending ? 'Changing…' : 'Change password'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

// ── Two-factor authentication ──────────────────────────────────────────────

function TwoFactorSection() {
  const { user, refreshUser } = useAuth()
  const { toast } = useToast()
  const [setupData, setSetupData] = useState<TwoFaSetupResponse | null>(null)
  const [enableCode, setEnableCode] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [showDisable, setShowDisable] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setupMutation = useMutation({
    mutationFn: () => api.post<TwoFaSetupResponse>('/auth/2fa/setup'),
    onSuccess: (res) => {
      setSetupData(res.data)
      setError(null)
    },
    onError: (err) => toast(getApiErrorMessage(err), 'error'),
  })

  const enableMutation = useMutation({
    mutationFn: (totp_code: string) => api.post('/auth/2fa/enable', { totp_code }),
    onSuccess: async () => {
      toast('Two-factor authentication enabled', 'success')
      setSetupData(null)
      setEnableCode('')
      setError(null)
      await refreshUser()
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  })

  const disableMutation = useMutation({
    mutationFn: (totp_code: string) => api.delete('/auth/2fa', { data: { totp_code } }),
    onSuccess: async () => {
      toast('Two-factor authentication disabled', 'success')
      setShowDisable(false)
      setDisableCode('')
      setError(null)
      await refreshUser()
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  })

  const handleEnable = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    enableMutation.mutate(enableCode)
  }

  const handleDisable = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    disableMutation.mutate(disableCode)
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Two-factor authentication</CardTitle>
        <Badge variant={user?.totp_enabled ? 'success' : 'muted'}>{user?.totp_enabled ? 'Enabled' : 'Disabled'}</Badge>
      </CardHeader>
      <CardContent>
        {!user?.totp_enabled && !setupData && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              Add an extra layer of security to your account using an authenticator app (e.g. Google Authenticator, Authy).
            </p>
            <Button className="self-start" onClick={() => setupMutation.mutate()} disabled={setupMutation.isPending}>
              {setupMutation.isPending ? 'Generating…' : 'Set up 2FA'}
            </Button>
          </div>
        )}

        {!user?.totp_enabled && setupData && (
          <form onSubmit={handleEnable} className="flex flex-col gap-3">
            <p className="text-sm text-muted">Scan this QR code with your authenticator app, then enter the 6-digit code below.</p>
            <img src={setupData.qr_code} alt="2FA QR code" className="h-40 w-40 rounded-md border border-border bg-white p-2" />
            <p className="text-xs text-muted">
              Or enter this secret manually: <code className="rounded bg-card px-1.5 py-0.5 text-foreground">{setupData.secret}</code>
            </p>
            <Input
              placeholder="6-digit code"
              value={enableCode}
              onChange={(e) => setEnableCode(e.target.value)}
              maxLength={6}
              inputMode="numeric"
              required
              className="max-w-[200px]"
            />
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button type="submit" className="self-start" disabled={enableMutation.isPending}>
              {enableMutation.isPending ? 'Verifying…' : 'Verify and enable'}
            </Button>
          </form>
        )}

        {user?.totp_enabled && !showDisable && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">Two-factor authentication is currently protecting your account.</p>
            <Button variant="destructive" className="self-start" onClick={() => setShowDisable(true)}>
              Disable 2FA
            </Button>
          </div>
        )}

        {user?.totp_enabled && showDisable && (
          <form onSubmit={handleDisable} className="flex flex-col gap-3">
            <p className="text-sm text-muted">Enter your current 6-digit authenticator code to disable 2FA.</p>
            <Input
              placeholder="6-digit code"
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value)}
              maxLength={6}
              inputMode="numeric"
              required
              className="max-w-[200px]"
            />
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" variant="destructive" disabled={disableMutation.isPending}>
                {disableMutation.isPending ? 'Disabling…' : 'Confirm disable'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowDisable(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

// ── Sessions ───────────────────────────────────────────────────────────────

function SessionsSection() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => (await api.get<{ sessions: Session[] }>('/users/me/sessions')).data.sessions,
  })

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/users/me/sessions/${id}`),
    onSuccess: () => {
      toast('Session revoked', 'success')
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
    },
    onError: (err) => toast(getApiErrorMessage(err), 'error'),
  })

  const revokeAllMutation = useMutation({
    mutationFn: () => api.delete('/users/me/sessions'),
    onSuccess: () => {
      toast('All sessions revoked', 'success')
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
    },
    onError: (err) => toast(getApiErrorMessage(err), 'error'),
  })

  const sessions = sessionsQuery.data ?? []

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Active sessions</CardTitle>
        {sessions.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => revokeAllMutation.mutate()} disabled={revokeAllMutation.isPending}>
            Sign out everywhere
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {sessionsQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}
        {sessions.length === 0 && !sessionsQuery.isLoading && <p className="text-sm text-muted">No active sessions.</p>}
        {sessions.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device</TableHead>
                <TableHead>IP address</TableHead>
                <TableHead>Last active</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((session) => (
                <TableRow key={session.id}>
                  <TableCell className="text-foreground">{session.device_name ?? session.user_agent ?? 'Unknown device'}</TableCell>
                  <TableCell className="text-muted">{session.ip_address ?? '—'}</TableCell>
                  <TableCell className="text-muted">{formatDate(session.last_activity)}</TableCell>
                  <TableCell className="text-muted">{formatDate(session.expires_at)}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => revokeMutation.mutate(session.id)}
                      disabled={revokeMutation.isPending}
                    >
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

// ── API keys ───────────────────────────────────────────────────────────────

function ApiKeysSection() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [createOpen, setCreateOpen] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState<ApiKeyCreateResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const keysQuery = useQuery({
    queryKey: ['api-keys'],
    queryFn: async () => (await api.get<{ api_keys: ApiKey[] }>('/api-keys')).data.api_keys,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['api-keys'] })

  const createMutation = useMutation({
    mutationFn: (name: string) => api.post<ApiKeyCreateResponse>('/api-keys', { name }),
    onSuccess: (res) => {
      setCreatedKey(res.data)
      setCreateOpen(false)
      setNewKeyName('')
      setError(null)
      invalidate()
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  })

  const rotateMutation = useMutation({
    mutationFn: (id: string) => api.post<ApiKeyCreateResponse>(`/api-keys/${id}/rotate`),
    onSuccess: (res) => {
      setCreatedKey(res.data)
      invalidate()
    },
    onError: (err) => toast(getApiErrorMessage(err), 'error'),
  })

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api-keys/${id}`),
    onSuccess: () => {
      toast('API key revoked', 'success')
      invalidate()
    },
    onError: (err) => toast(getApiErrorMessage(err), 'error'),
  })

  const handleCreate = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    createMutation.mutate(newKeyName)
  }

  const copyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key)
      toast('Copied to clipboard', 'success')
    } catch {
      toast('Could not copy — please copy manually', 'error')
    }
  }

  const keys = keysQuery.data ?? []

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>API keys</CardTitle>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <KeyRound size={14} />
          New API key
        </Button>
      </CardHeader>
      <CardContent>
        {keysQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}
        {keys.length === 0 && !keysQuery.isLoading && <p className="text-sm text-muted">No API keys yet.</p>}
        {keys.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell className="font-medium text-foreground">{key.name}</TableCell>
                  <TableCell>
                    <Badge variant={key.active ? 'success' : 'muted'}>{key.active ? 'Active' : 'Revoked'}</Badge>
                  </TableCell>
                  <TableCell className="text-muted">{formatDate(key.last_used_at)}</TableCell>
                  <TableCell className="text-muted">{formatDate(key.created_at)}</TableCell>
                  <TableCell className="text-muted">{key.expires_at ? formatDate(key.expires_at) : 'Never'}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      {key.active && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => rotateMutation.mutate(key.id)}
                            disabled={rotateMutation.isPending}
                          >
                            Rotate
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => revokeMutation.mutate(key.id)}
                            disabled={revokeMutation.isPending}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false)
          setError(null)
        }}
        title="Create API key"
      >
        <form onSubmit={handleCreate} className="flex flex-col gap-3">
          <Input placeholder="Key name (e.g. Trading bot)" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} required />
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creating…' : 'Create key'}
          </Button>
        </form>
      </Dialog>

      <Dialog open={!!createdKey} onClose={() => setCreatedKey(null)} title="API key created">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-amber-400">{createdKey?.warning}</p>
          <div className="flex items-center gap-2 rounded-md border border-border bg-card p-3">
            <code className="flex-1 break-all text-sm text-foreground">{createdKey?.api_key.key}</code>
            <Button size="sm" variant="outline" onClick={() => createdKey && copyKey(createdKey.api_key.key)}>
              <Copy size={14} />
            </Button>
          </div>
          <Button onClick={() => setCreatedKey(null)}>Done</Button>
        </div>
      </Dialog>
    </Card>
  )
}
