import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { adminKeys, auditApi, staffAdminApi, type StaffWithPassword } from '@/api/admin'
import { isApiError } from '@/api/client'
import { customerKeys, customersApi } from '@/api/customers'
import { staffKeys } from '@/api/staff'
import { DataTable, type Column } from '@/components/data/DataTable'
import { Select } from '@/components/form/inputs'
import { ErrorState, LoadingState } from '@/components/states'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { BackLink, DescriptionList, Panel } from '@/components/ui/display'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useToast } from '@/components/ui/Toast'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { useOfficers } from '@/features/shared/lookups'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { formatDate, formatDateTime } from '@/lib/dates'
import { hasPermission } from '@/lib/permissions'
import { formatPhone } from '@/lib/phone'
import { ROLE_LABELS, type Customer, type Staff } from '@/types'
import { PermissionsDialog, PermissionsPanel } from './StaffPermissions'
import { StaffDialog, TemporaryPasswordDialog } from './StaffPage'

type Action = 'suspend' | 'deactivate' | 'reactivate' | 'reset' | null

export function StaffDetailPage() {
  const { id = '' } = useParams()
  const query = useQuery({
    queryKey: adminKeys.staffDetail(id),
    queryFn: () => staffAdminApi.get(id),
  })
  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  return <StaffView staff={query.data} />
}

function StaffView({ staff: s }: { staff: Staff & { mustChangePassword: boolean } }) {
  const name = `${s.firstName} ${s.lastName}`
  useDocumentTitle(name)
  const me = useCurrentUser()
  const canManage =
    hasPermission(me, 'staff.manage') && me.id !== s.id && (s.role !== 'md' || me.role === 'md')
  // Nobody changes their own permissions, and the MD always has every permission.
  const canAssign = hasPermission(me, 'staff.permissions') && me.id !== s.id && s.role !== 'md'
  const [editing, setEditing] = useState(false)
  const [editingPermissions, setEditingPermissions] = useState(false)
  const [action, setAction] = useState<Action>(null)
  const [password, setPassword] = useState<StaffWithPassword | null>(null)
  const queryClient = useQueryClient()
  const toast = useToast()
  const activity = useQuery({
    queryKey: ['audit', 'actor', s.id],
    queryFn: () => auditApi.list({ actor: s.id, pageSize: 10 }),
  })
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: staffKeys.all }),
      queryClient.invalidateQueries({ queryKey: adminKeys.staffDetail(s.id) }),
    ])

  return (
    <>
      <BackLink to="/staff">Staff</BackLink>
      <header className="border-rule mb-6 flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{name}</h1>
            <StatusBadge status={s.status} />
          </div>
          <p className="text-ink-2 mt-1 text-sm">
            <span className="font-mono">{s.staffId}</span> · {ROLE_LABELS[s.role]} ·{' '}
            {s.branchName ?? '—'}
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setEditing(true)}>Edit details</Button>
            <Button onClick={() => setAction('reset')}>Reset password</Button>
            {s.status === 'active' && <Button onClick={() => setAction('suspend')}>Suspend</Button>}
            {s.status !== 'active' && (
              <Button variant="primary" onClick={() => setAction('reactivate')}>
                Reactivate
              </Button>
            )}
            {s.status !== 'deactivated' && (
              <Button variant="danger" onClick={() => setAction('deactivate')}>
                Deactivate
              </Button>
            )}
          </div>
        )}
      </header>

      {s.mustChangePassword && (
        <Alert tone="info" className="mb-6">
          {s.firstName} hasn’t chosen their own password yet.
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <Panel title="Details">
            <DescriptionList
              columns={1}
              items={[
                { label: 'Email', value: s.email },
                { label: 'Mobile', value: formatPhone(s.phone) },
                {
                  label: 'Last sign-in',
                  value: s.lastLoginAt ? formatDateTime(s.lastLoginAt) : 'Never',
                },
                { label: 'Added', value: formatDate(s.createdAt) },
              ]}
            />
          </Panel>
          <PermissionsPanel
            staff={s}
            onEdit={canAssign ? () => setEditingPermissions(true) : undefined}
          />
          <Panel
            title="Recent activity"
            flush
            actions={
              <Link
                to={`/audit-log?search=${encodeURIComponent(name)}`}
                className="text-sm font-medium underline"
              >
                All
              </Link>
            }
          >
            <ul className="divide-rule divide-y">
              {activity.data?.results.map((a) => (
                <li key={a.id} className="px-4 py-2 text-sm">
                  {a.summary}
                  <span className="text-ink-2 block text-xs">
                    {formatDateTime(a.at)} · {a.ipAddress}
                  </span>
                </li>
              ))}
              {activity.data?.results.length === 0 && (
                <li className="text-ink-2 px-4 py-3 text-sm">No activity recorded.</li>
              )}
            </ul>
          </Panel>
        </div>
        {s.role === 'account_officer' && <OfficerCustomers officer={s} />}
      </div>

      {editing && (
        <StaffDialog
          staff={s}
          onClose={() => {
            setEditing(false)
            void refresh()
          }}
        />
      )}
      {editingPermissions && (
        <PermissionsDialog
          staff={s}
          onClose={() => {
            setEditingPermissions(false)
            void refresh()
          }}
        />
      )}
      <TemporaryPasswordDialog result={password} onClose={() => setPassword(null)} />
      <ConfirmDialog
        open={action !== null}
        onClose={() => setAction(null)}
        title={
          action === 'reset'
            ? `Reset ${s.firstName}’s password?`
            : action === 'reactivate'
              ? `Let ${s.firstName} sign in again?`
              : action === 'suspend'
                ? `Suspend ${s.firstName}?`
                : `Deactivate ${s.firstName}?`
        }
        confirmLabel={
          action === 'reset'
            ? 'Reset password'
            : action === 'reactivate'
              ? 'Reactivate'
              : action === 'suspend'
                ? 'Suspend'
                : 'Deactivate'
        }
        tone={action === 'reactivate' || action === 'reset' ? 'primary' : 'danger'}
        reason={
          action === 'suspend' || action === 'deactivate'
            ? { label: 'Reason', hint: 'Kept in the audit log.', minLength: 5 }
            : undefined
        }
        onConfirm={async (reason) => {
          if (action === 'reset') setPassword(await staffAdminApi.resetPassword(s.id))
          if (action === 'suspend') await staffAdminApi.suspend(s.id, reason)
          if (action === 'deactivate') await staffAdminApi.deactivate(s.id, reason)
          if (action === 'reactivate') await staffAdminApi.reactivate(s.id)
          await refresh()
          if (action !== 'reset')
            toast({
              title: `${name} ${action === 'reactivate' ? 'reactivated' : action === 'suspend' ? 'suspended' : 'deactivated'}`,
            })
        }}
      >
        <p>
          {action === 'reset' &&
            'Their current password stops working. You’ll see a temporary one to give them.'}
          {action === 'suspend' &&
            'They are signed out and can’t sign in until reactivated. Their customers stay assigned to them.'}
          {action === 'deactivate' &&
            'For people who have left. They can’t sign in. Officers must have no customers left.'}
          {action === 'reactivate' && 'They can sign in again with their existing password.'}
        </p>
      </ConfirmDialog>
    </>
  )
}

/** The officer's customers, with bulk reassignment to another officer. */
function OfficerCustomers({ officer }: { officer: Staff }) {
  const me = useCurrentUser()
  const canMove = hasPermission(me, 'customers.reassign')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [target, setTarget] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const officers = useOfficers(officer.branchId, canMove)
  const params = { officer: officer.id, page, pageSize: 50, ordering: 'area' }
  const query = useQuery({
    queryKey: customerKeys.list(params),
    queryFn: () => customersApi.list(params),
    placeholderData: keepPreviousData,
  })
  const queryClient = useQueryClient()
  const toast = useToast()

  const move = async () => {
    if (!target) {
      setError('Choose the officer who will take them.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { moved } = await staffAdminApi.reassignCustomers([...selected], target)
      await queryClient.invalidateQueries({ queryKey: customerKeys.all })
      toast({
        title: `${moved} customers moved`,
        description: `They appear on ${officers.data?.find((o) => o.id === target)?.name}’s list from now on.`,
      })
      setSelected(new Set())
    } catch (e) {
      setError(
        isApiError(e)
          ? [...e.formErrors, ...Object.values(e.fieldErrors).flat()].join(' ') || e.message
          : 'Not moved. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<Customer>[] = [
    {
      id: 'name',
      header: 'Customer',
      cell: (c) => (
        <Link
          to={`/customers/${c.id}`}
          className="hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {c.firstName} {c.lastName}
        </Link>
      ),
    },
    { id: 'area', header: 'Area', cell: (c) => c.area },
    { id: 'phone', header: 'Phone', cell: (c) => formatPhone(c.phone) },
    { id: 'status', header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
  ]

  return (
    <Panel title={`Customers (${query.data?.count ?? '…'})`} flush>
      {error && (
        <Alert tone="danger" className="m-3">
          {error}
        </Alert>
      )}
      <div className="[&>div]:rounded-none [&>div]:border-0">
        <DataTable
          caption="Officer's customers"
          columns={columns}
          rows={query.data?.results}
          getRowId={(c) => c.id}
          isLoading={query.isPending}
          error={query.error}
          maxHeight="32rem"
          selection={canMove ? { selected, onChange: setSelected } : undefined}
          bulkActions={() => (
            <span className="flex flex-wrap items-center gap-2">
              <Select
                label="Move to"
                hideLabel
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="h-8 text-sm"
              >
                <option value="">Move to…</option>
                {officers.data
                  ?.filter((o) => o.id !== officer.id && o.status === 'active')
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
              </Select>
              <Button size="sm" variant="primary" loading={busy} onClick={move}>
                Move selected customers
              </Button>
            </span>
          )}
          empty={{
            title: 'No customers assigned',
            description: 'This officer can be deactivated.',
          }}
          pagination={
            query.data && { page, pageSize: 50, count: query.data.count, onPageChange: setPage }
          }
        />
      </div>
    </Panel>
  )
}
