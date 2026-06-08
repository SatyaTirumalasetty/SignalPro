import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@shared/components/ui/card'
import { Button } from '@shared/components/ui/button'
import { Badge } from '@shared/components/ui/badge'
import { Dialog } from '@shared/components/ui/dialog'
import { Input } from '@shared/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/components/ui/table'
import { useToast } from '@shared/hooks/useToast'
import { api, getApiErrorMessage } from '@shared/lib/api'
import { formatDate } from '@shared/lib/format'
import type { AdminActivityEntry, AdminUserDetail, AdminUserSummary } from '@shared/types/api'

const statusVariant: Record<string, 'success' | 'danger' | 'muted' | 'default'> = {
  active: 'success',
  suspended: 'danger',
  deleted: 'muted',
}

const kycVariant: Record<string, 'success' | 'danger' | 'muted' | 'default'> = {
  verified: 'success',
  rejected: 'danger',
  pending: 'muted',
}

const PAGE_SIZE = 50

export function AdminUsersPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [kycFilter, setKycFilter] = useState('')
  const [offset, setOffset] = useState(0)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [suspending, setSuspending] = useState<AdminUserSummary | null>(null)
  const [suspendReason, setSuspendReason] = useState('')
  const [kycTarget, setKycTarget] = useState<{ user: AdminUserDetail; decision: 'verified' | 'rejected' } | null>(null)
  const [kycNotes, setKycNotes] = useState('')

  const params = {
    limit: PAGE_SIZE,
    offset,
    ...(search ? { q: search } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(kycFilter ? { kyc_status: kycFilter } : {}),
  }

  const usersQuery = useQuery({
    queryKey: ['admin-users', params],
    queryFn: async () =>
      (await api.get<{ users: AdminUserSummary[]; total: number; limit: number; offset: number }>('/admin/users', { params })).data,
  })

  const detailQuery = useQuery({
    queryKey: ['admin-user-detail', selectedUserId],
    queryFn: async () =>
      (await api.get<{ user: AdminUserDetail; recent_activity: AdminActivityEntry[] }>(`/admin/users/${selectedUserId}`)).data,
    enabled: !!selectedUserId,
  })

  const invalidateUsers = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    queryClient.invalidateQueries({ queryKey: ['admin-user-detail'] })
  }

  const suspendMutation = useMutation({
    mutationFn: (payload: { id: string; reason: string }) =>
      api.post(`/admin/users/${payload.id}/suspend`, { reason: payload.reason || undefined }),
    onSuccess: (res) => {
      toast(res.data?.message || 'User suspended', 'success')
      invalidateUsers()
      setSuspending(null)
      setSuspendReason('')
    },
    onError: (err) => toast(getApiErrorMessage(err), 'error'),
  })

  const unsuspendMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/users/${id}/suspend`),
    onSuccess: (res) => {
      toast(res.data?.message || 'User unsuspended', 'success')
      invalidateUsers()
    },
    onError: (err) => toast(getApiErrorMessage(err), 'error'),
  })

  const kycMutation = useMutation({
    mutationFn: (payload: { id: string; status: 'verified' | 'rejected'; notes: string }) =>
      api.post(`/admin/users/${payload.id}/verify-kyc`, { status: payload.status, notes: payload.notes || undefined }),
    onSuccess: (res) => {
      toast(res.data?.message || 'KYC updated', 'success')
      invalidateUsers()
      setKycTarget(null)
      setKycNotes('')
    },
    onError: (err) => toast(getApiErrorMessage(err), 'error'),
  })

  const users = usersQuery.data?.users ?? []
  const total = usersQuery.data?.total ?? 0
  const detail = detailQuery.data

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Users</h1>
        <p className="text-sm text-muted">Search, review, and manage user accounts</p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center">
          <Input
            placeholder="Search by email or name…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setOffset(0)
            }}
            className="sm:max-w-xs"
          />
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value)
              setOffset(0)
            }}
            className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="deleted">Deleted</option>
          </select>
          <select
            value={kycFilter}
            onChange={(e) => {
              setKycFilter(e.target.value)
              setOffset(0)
            }}
            className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground"
          >
            <option value="">All KYC statuses</option>
            <option value="pending">Pending</option>
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
          </select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{total} user{total === 1 ? '' : 's'}</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {usersQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}
          {!usersQuery.isLoading && users.length === 0 && <p className="text-sm text-muted">No users match these filters.</p>}
          {!!users.length && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>KYC</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Brokers</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <button
                        onClick={() => setSelectedUserId(u.id)}
                        className="text-left text-foreground hover:text-primary cursor-pointer"
                      >
                        <div className="font-medium">{u.full_name}</div>
                        <div className="text-xs text-muted">{u.email}</div>
                      </button>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[u.status] ?? 'muted'}>{u.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={kycVariant[u.kyc_status] ?? 'muted'}>{u.kyc_status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted">{u.plan_tier ?? '—'}</TableCell>
                    <TableCell className="text-muted">{u.broker_count}</TableCell>
                    <TableCell className="text-muted">{formatDate(u.created_at)}</TableCell>
                    <TableCell>
                      {u.status === 'suspended' ? (
                        <Button size="sm" variant="outline" onClick={() => unsuspendMutation.mutate(u.id)} disabled={unsuspendMutation.isPending}>
                          Unsuspend
                        </Button>
                      ) : u.status === 'active' ? (
                        <Button size="sm" variant="destructive" onClick={() => setSuspending(u)}>
                          Suspend
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedUserId} onClose={() => setSelectedUserId(null)} title="User details">
        {detailQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}
        {detail && (
          <div className="flex flex-col gap-4">
            <div>
              <div className="text-base font-medium text-foreground">{detail.user.full_name}</div>
              <div className="text-sm text-muted">{detail.user.email}</div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted">Status</div>
                <Badge variant={statusVariant[detail.user.status] ?? 'muted'}>{detail.user.status}</Badge>
              </div>
              <div>
                <div className="text-xs text-muted">KYC</div>
                <Badge variant={kycVariant[detail.user.kyc_status] ?? 'muted'}>{detail.user.kyc_status}</Badge>
              </div>
              <div>
                <div className="text-xs text-muted">Plan</div>
                <div className="text-foreground">{detail.user.plan_name ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs text-muted">Subscription</div>
                <div className="text-foreground">{detail.user.subscription_status ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs text-muted">Email verified</div>
                <div className="text-foreground">{detail.user.email_verified ? 'Yes' : 'No'}</div>
              </div>
              <div>
                <div className="text-xs text-muted">2FA enabled</div>
                <div className="text-foreground">{detail.user.totp_enabled ? 'Yes' : 'No'}</div>
              </div>
              <div>
                <div className="text-xs text-muted">Joined</div>
                <div className="text-foreground">{formatDate(detail.user.created_at)}</div>
              </div>
              <div>
                <div className="text-xs text-muted">Last updated</div>
                <div className="text-foreground">{formatDate(detail.user.updated_at)}</div>
              </div>
            </div>

            {detail.user.kyc_status === 'pending' && (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setKycTarget({ user: detail.user, decision: 'verified' })}>
                  Approve KYC
                </Button>
                <Button size="sm" variant="destructive" onClick={() => setKycTarget({ user: detail.user, decision: 'rejected' })}>
                  Reject KYC
                </Button>
              </div>
            )}

            <div>
              <div className="mb-2 text-sm font-medium text-foreground">Recent activity</div>
              {detail.recent_activity.length === 0 && <p className="text-sm text-muted">No recent activity.</p>}
              {!!detail.recent_activity.length && (
                <div className="flex flex-col gap-2">
                  {detail.recent_activity.map((a, i) => (
                    <div key={i} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                      <div>
                        <span className="font-medium text-foreground">{a.action}</span>
                        <span className="text-muted"> · {a.entity_type}</span>
                      </div>
                      <div className="text-xs text-muted">{formatDate(a.created_at)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Dialog>

      <Dialog open={!!suspending} onClose={() => setSuspending(null)} title="Suspend user">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            Suspend <span className="text-foreground">{suspending?.email}</span>? They will be unable to sign in until reactivated.
          </p>
          <Input
            placeholder="Reason (optional)"
            value={suspendReason}
            onChange={(e) => setSuspendReason(e.target.value)}
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setSuspending(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={suspendMutation.isPending}
              onClick={() => suspending && suspendMutation.mutate({ id: suspending.id, reason: suspendReason })}
            >
              {suspendMutation.isPending ? 'Suspending…' : 'Suspend user'}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={!!kycTarget} onClose={() => setKycTarget(null)} title={kycTarget?.decision === 'verified' ? 'Approve KYC' : 'Reject KYC'}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            {kycTarget?.decision === 'verified' ? 'Approve' : 'Reject'} KYC for{' '}
            <span className="text-foreground">{kycTarget?.user.email}</span>?
          </p>
          <Input placeholder="Notes (optional)" value={kycNotes} onChange={(e) => setKycNotes(e.target.value)} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setKycTarget(null)}>
              Cancel
            </Button>
            <Button
              variant={kycTarget?.decision === 'rejected' ? 'destructive' : 'default'}
              disabled={kycMutation.isPending}
              onClick={() =>
                kycTarget &&
                kycMutation.mutate({ id: kycTarget.user.id, status: kycTarget.decision, notes: kycNotes })
              }
            >
              {kycMutation.isPending ? 'Saving…' : kycTarget?.decision === 'verified' ? 'Approve' : 'Reject'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
