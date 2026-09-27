import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { staffAdminApi, type StaffInput, type StaffWithPassword } from '@/api/admin'
import { isApiError } from '@/api/client'
import { staffApi, staffKeys } from '@/api/staff'
import { DataTable, type Column } from '@/components/data/DataTable'
import { FilterBar, FilterSelect, SearchBox } from '@/components/data/Filters'
import { Select, TextInput } from '@/components/form/inputs'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useToast } from '@/components/ui/Toast'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { Can } from '@/features/auth/Can'
import { useBranchScope } from '@/features/organisation/BranchScope'
import { useListParams } from '@/hooks/useListParams'
import { formatDateTime } from '@/lib/dates'
import { hasPermission } from '@/lib/permissions'
import { formatPhone } from '@/lib/phone'
import {
  HEADQUARTERS_ROLES,
  ROLE_LABELS,
  ROLES,
  type Permission,
  type Role,
  type Staff,
  type StaffListParams,
  type StaffStatus,
} from '@/types'
import { PermissionPicker, useRolePermissions } from './PermissionPicker'

export function StaffPage() {
  const navigate = useNavigate()
  const { branchId } = useBranchScope()
  const [adding, setAdding] = useState(false)
  const list = useListParams(['role', 'status'] as const, { ordering: 'last_name' })
  const params: StaffListParams = {
    page: list.page,
    pageSize: list.pageSize,
    ordering: list.ordering,
    search: list.search || undefined,
    branch: branchId ?? undefined,
    role: list.filters.role as Role | undefined,
    status: list.filters.status as StaffStatus | undefined,
  }
  const query = useQuery({
    queryKey: staffKeys.list(params),
    queryFn: () => staffApi.list(params),
    placeholderData: keepPreviousData,
  })
  const columns: Column<Staff>[] = [
    {
      id: 'name',
      header: 'Name',
      sortKey: 'last_name',
      cell: (s) => (
        <Link
          to={`/staff/${s.id}`}
          className="font-medium hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {s.firstName} {s.lastName}
          <span className="text-ink-2 block font-mono text-xs font-normal">{s.staffId}</span>
        </Link>
      ),
    },
    { id: 'role', header: 'Role', sortKey: 'role', cell: (s) => ROLE_LABELS[s.role] },
    {
      id: 'branch',
      header: 'Branch',
      sortKey: 'branch_name',
      cell: (s) => s.branchName ?? '—',
    },
    { id: 'email', header: 'Email', cell: (s) => s.email },
    { id: 'phone', header: 'Phone', cell: (s) => formatPhone(s.phone) },
    {
      id: 'login',
      header: 'Last sign-in',
      sortKey: 'last_login_at',
      cell: (s) =>
        s.lastLoginAt ? formatDateTime(s.lastLoginAt) : <span className="text-ink-2">Never</span>,
    },
    { id: 'status', header: 'Status', cell: (s) => <StatusBadge status={s.status} /> },
  ]
  return (
    <>
      <PageHeader
        title="Staff"
        description="Everyone who can sign in. Suspending someone stops them signing in straight away."
        actions={
          <Can permission="staff.permissions">
            <Button
              variant="primary"
              icon={<Plus className="size-4" aria-hidden />}
              onClick={() => setAdding(true)}
            >
              Add staff member
            </Button>
          </Can>
        }
      />
      <DataTable
        caption="Staff"
        columns={columns}
        rows={query.data?.results}
        getRowId={(s) => s.id}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={(s) => navigate(`/staff/${s.id}`)}
        ordering={list.ordering}
        onOrderingChange={list.setOrdering}
        density="comfortable"
        empty={{
          title: 'No staff match these filters',
          action: (
            <Button size="sm" onClick={list.clearFilters}>
              Clear filters
            </Button>
          ),
        }}
        toolbar={
          <FilterBar>
            <SearchBox
              label="Search"
              value={list.search}
              onChange={list.setSearch}
              placeholder="Name, email or staff ID"
            />
            <FilterSelect
              label="Role"
              value={list.filters.role ?? ''}
              onChange={(e) => list.setFilter('role', e.target.value)}
            >
              <option value="">All roles</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              label="Status"
              value={list.filters.status ?? ''}
              onChange={(e) => list.setFilter('status', e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="deactivated">Deactivated</option>
            </FilterSelect>
          </FilterBar>
        }
        pagination={
          query.data && {
            page: list.page,
            pageSize: list.pageSize,
            count: query.data.count,
            onPageChange: list.setPage,
            onPageSizeChange: list.setPageSize,
          }
        }
      />
      {adding && <StaffDialog staff={null} onClose={() => setAdding(false)} />}
    </>
  )
}

/** Shows a temporary password exactly once. */
export function TemporaryPasswordDialog({
  result,
  onClose,
}: {
  result: StaffWithPassword | null
  onClose: () => void
}) {
  return (
    <Dialog
      open={result !== null}
      onClose={onClose}
      size="sm"
      title="Temporary password"
      description={
        result
          ? `Give this to ${result.staff.firstName} in person or by phone. It is shown only once.`
          : undefined
      }
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      {result && (
        <div className="flex flex-col gap-3">
          <p className="bg-paper rounded px-4 py-3 text-center font-mono text-2xl font-semibold tracking-wide">
            {result.temporaryPassword}
          </p>
          <p className="text-ink-2 text-sm">
            {result.staff.firstName} signs in with {result.staff.email} and this password, then must
            choose their own. The sign-in code goes to {formatPhone(result.staff.phone)}.
          </p>
          {result.staff.temporaryPasswordExpiresAt && (
            <p className="text-ink-2 text-sm">
              It works until{' '}
              <strong className="text-ink">
                {formatDateTime(result.staff.temporaryPasswordExpiresAt)}
              </strong>
              . After that, reset the password to issue a new one.
            </p>
          )}
        </div>
      )}
    </Dialog>
  )
}

export function StaffDialog({ staff, onClose }: { staff: Staff | null; onClose: () => void }) {
  const { branches } = useBranchScope()
  const me = useCurrentUser()
  const canAssign = hasPermission(me, 'staff.permissions')
  const [v, setV] = useState<Omit<StaffInput, 'permissions'>>({
    firstName: staff?.firstName ?? '',
    lastName: staff?.lastName ?? '',
    email: staff?.email ?? '',
    phone: staff?.phone ?? '',
    role: staff?.role ?? 'account_officer',
    branchId: staff?.branchId ?? branches[0]?.id ?? null,
  })
  // Null until the user touches the checklist: start from everything they may give.
  const [picked, setPicked] = useState<Permission[] | null>(null)
  const rolePermissions = useRolePermissions(v.role)
  const permissions = picked ?? [
    ...new Set([...rolePermissions.required, ...rolePermissions.grantable]),
  ]
  // Choosing permissions is part of adding someone, or of moving them to another role.
  const choosing = !staff || v.role !== staff.role
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<StaffWithPassword | null>(null)
  const queryClient = useQueryClient()
  const toast = useToast()
  // The server places head-office roles at headquarters.
  const headOffice = HEADQUARTERS_ROLES.includes(v.role)
  const set =
    (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setV((x) => ({ ...x, [k]: e.target.value }))
      if (k === 'role') setPicked(null)
    }

  const submit = async () => {
    setBusy(true)
    setErrors({})
    try {
      if (staff) {
        await staffAdminApi.update(staff.id, {
          ...v,
          branchId: headOffice ? null : v.branchId,
          ...(choosing ? { permissions } : {}),
        })
        toast({ title: 'Staff details saved' })
        await queryClient.invalidateQueries({ queryKey: staffKeys.all })
        onClose()
      } else {
        const result = await staffAdminApi.create({
          ...v,
          branchId: headOffice ? null : v.branchId,
          permissions,
        })
        await queryClient.invalidateQueries({ queryKey: staffKeys.all })
        setCreated(result)
      }
    } catch (e) {
      if (isApiError(e))
        setErrors({
          ...Object.fromEntries(
            Object.entries(e.fieldErrors).map(([k, val]) => [k, val.join(' ')]),
          ),
          form: e.formErrors.join(' '),
        })
      else setErrors({ form: 'Not saved. Try again.' })
    } finally {
      setBusy(false)
    }
  }

  if (created) return <TemporaryPasswordDialog result={created} onClose={onClose} />

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      size={choosing ? 'lg' : 'md'}
      title={staff ? `Edit ${staff.firstName} ${staff.lastName}` : 'Add a staff member'}
      description={
        staff
          ? undefined
          : 'They get a temporary password and must choose their own the first time they sign in.'
      }
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {staff ? 'Save changes' : 'Add staff member'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {errors.form && (
          <Alert tone="danger" className="sm:col-span-2">
            {errors.form}
          </Alert>
        )}
        <TextInput
          label="First name"
          value={v.firstName}
          onChange={set('firstName')}
          error={errors.firstName}
        />
        <TextInput
          label="Last name"
          value={v.lastName}
          onChange={set('lastName')}
          error={errors.lastName}
        />
        <TextInput
          label="Work email"
          type="email"
          value={v.email}
          onChange={set('email')}
          error={errors.email}
          hint="They sign in with this."
        />
        <TextInput
          label="Mobile number"
          type="tel"
          value={v.phone}
          onChange={set('phone')}
          error={errors.phone}
          hint="Sign-in codes are sent here."
        />
        <Select
          label="Role"
          value={v.role}
          onChange={set('role')}
          error={errors.role}
          disabled={!canAssign}
          hint={canAssign ? undefined : 'Only the MD or general manager can change roles.'}
        >
          {/* Only the MD can make someone a managing director. */}
          {ROLES.filter((r) => r !== 'md' || me.role === 'md' || staff?.role === 'md').map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
        {headOffice ? (
          <TextInput
            label="Branch"
            value="Headquarters (oversees every branch)"
            disabled
            readOnly
          />
        ) : (
          <Select
            label="Branch"
            value={v.branchId ?? ''}
            onChange={set('branchId')}
            error={errors.branchId}
          >
            <option value="">Choose…</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
        {choosing && (
          <section
            className="border-rule border-t pt-4 sm:col-span-2"
            aria-labelledby="perm-heading"
          >
            <h3 id="perm-heading" className="text-base font-semibold">
              Permissions
            </h3>
            <p className="text-ink-2 mb-3 text-sm">
              {staff
                ? `Choose what ${staff.firstName} can do as ${ROLE_LABELS[v.role].toLowerCase()}.`
                : 'Choose what this person can do. The list shows everything their role allows.'}
            </p>
            <PermissionPicker
              role={v.role}
              value={permissions}
              onChange={setPicked}
              error={errors.permissions}
            />
          </section>
        )}
      </div>
    </Dialog>
  )
}
