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
import type { SupportTicket } from '@shared/types/api'

const statusVariant: Record<string, 'success' | 'danger' | 'muted' | 'default'> = {
  open: 'default',
  in_progress: 'default',
  waiting_customer: 'muted',
  resolved: 'success',
  closed: 'muted',
}

const priorityVariant: Record<string, 'success' | 'danger' | 'muted' | 'default'> = {
  low: 'muted',
  medium: 'default',
  high: 'danger',
  critical: 'danger',
}

const PAGE_SIZE = 25

export function AdminSupportPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [statusFilter, setStatusFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [offset, setOffset] = useState(0)
  const [assigning, setAssigning] = useState<SupportTicket | null>(null)
  const [adminId, setAdminId] = useState('')
  const [resolving, setResolving] = useState<SupportTicket | null>(null)
  const [resolutionNotes, setResolutionNotes] = useState('')

  const params = {
    limit: PAGE_SIZE,
    offset,
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(priorityFilter ? { priority: priorityFilter } : {}),
  }

  const ticketsQuery = useQuery({
    queryKey: ['admin-support-tickets', params],
    queryFn: async () =>
      (await api.get<{ tickets: SupportTicket[]; total: number }>('/admin/support/tickets', { params })).data,
  })

  const invalidateTickets = () => queryClient.invalidateQueries({ queryKey: ['admin-support-tickets'] })

  const assignMutation = useMutation({
    mutationFn: (payload: { id: string; admin_id: string }) =>
      api.post(`/admin/support/tickets/${payload.id}/assign`, { admin_id: payload.admin_id }),
    onSuccess: () => {
      toast('Ticket assigned', 'success')
      invalidateTickets()
      setAssigning(null)
      setAdminId('')
    },
    onError: (err) => toast(getApiErrorMessage(err), 'error'),
  })

  const resolveMutation = useMutation({
    mutationFn: (payload: { id: string; resolution_notes: string }) =>
      api.post(`/admin/support/tickets/${payload.id}/resolve`, { resolution_notes: payload.resolution_notes }),
    onSuccess: () => {
      toast('Ticket resolved', 'success')
      invalidateTickets()
      setResolving(null)
      setResolutionNotes('')
    },
    onError: (err) => toast(getApiErrorMessage(err), 'error'),
  })

  const tickets = ticketsQuery.data?.tickets ?? []
  const total = ticketsQuery.data?.total ?? 0

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Support tickets</h1>
        <p className="text-sm text-muted">Triage, assign, and resolve customer tickets</p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center">
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value)
              setOffset(0)
            }}
            className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground"
          >
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="waiting_customer">Waiting on customer</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
          <select
            value={priorityFilter}
            onChange={(e) => {
              setPriorityFilter(e.target.value)
              setOffset(0)
            }}
            className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground"
          >
            <option value="">All priorities</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{total} ticket{total === 1 ? '' : 's'}</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
              Next
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {ticketsQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}
          {!ticketsQuery.isLoading && tickets.length === 0 && <p className="text-sm text-muted">No tickets match these filters.</p>}
          {!!tickets.length && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticket</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <div className="font-medium text-foreground">{t.title}</div>
                      <div className="text-xs text-muted">{t.category}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-foreground">{t.user_name}</div>
                      <div className="text-xs text-muted">{t.user_email}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={priorityVariant[t.priority] ?? 'default'}>{t.priority}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[t.status] ?? 'default'}>{t.status.replace('_', ' ')}</Badge>
                    </TableCell>
                    <TableCell className="text-muted">{formatDate(t.created_at)}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {t.status !== 'resolved' && t.status !== 'closed' && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setAssigning(t)}>
                              Assign
                            </Button>
                            <Button size="sm" onClick={() => setResolving(t)}>
                              Resolve
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
      </Card>

      <Dialog open={!!assigning} onClose={() => setAssigning(null)} title="Assign ticket">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            Assign <span className="text-foreground">{assigning?.title}</span> to an admin by their user ID.
          </p>
          <Input placeholder="Admin user ID (UUID)" value={adminId} onChange={(e) => setAdminId(e.target.value)} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setAssigning(null)}>
              Cancel
            </Button>
            <Button
              disabled={assignMutation.isPending || !adminId.trim()}
              onClick={() => assigning && assignMutation.mutate({ id: assigning.id, admin_id: adminId.trim() })}
            >
              {assignMutation.isPending ? 'Assigning…' : 'Assign'}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={!!resolving} onClose={() => setResolving(null)} title="Resolve ticket">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            Resolve <span className="text-foreground">{resolving?.title}</span> with notes for the record.
          </p>
          <Input placeholder="Resolution notes" value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setResolving(null)}>
              Cancel
            </Button>
            <Button
              disabled={resolveMutation.isPending || !resolutionNotes.trim()}
              onClick={() => resolving && resolveMutation.mutate({ id: resolving.id, resolution_notes: resolutionNotes.trim() })}
            >
              {resolveMutation.isPending ? 'Resolving…' : 'Resolve'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
