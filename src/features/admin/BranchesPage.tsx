import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { branchAdminApi, type BranchInput } from '@/api/admin'
import { branchesApi, branchKeys } from '@/api/branches'
import { isApiError } from '@/api/client'
import { staffApi, staffKeys } from '@/api/staff'
import { DataTable, type Column } from '@/components/data/DataTable'
import { Select, TextInput } from '@/components/form/inputs'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useToast } from '@/components/ui/Toast'
import { formatPhone } from '@/lib/phone'
import type { Branch } from '@/types'

export function BranchesPage() {
  const [editing, setEditing] = useState<Branch | 'new' | null>(null)
  const query = useQuery({ queryKey: branchKeys.list(), queryFn: () => branchesApi.list() })
  const columns: Column<Branch>[] = [
    { id: 'code', header: 'Code', cell: (b) => <span className="font-mono">{b.code}</span> },
    {
      id: 'name',
      header: 'Branch',
      cell: (b) => (
        <span className="font-medium">
          {b.name}
          {b.kind === 'headquarters' && (
            <span className="bg-ink-tint text-ink-2 ml-2 rounded-sm px-1.5 py-0.5 text-xs font-medium">
              Oversees every branch
            </span>
          )}
        </span>
      ),
    },
    { id: 'address', header: 'Address', cell: (b) => b.address },
    { id: 'phone', header: 'Phone', cell: (b) => formatPhone(b.phone) },
    {
      id: 'manager',
      header: 'Manager',
      cell: (b) => b.managerName ?? <span className="text-brick">No manager</span>,
    },
    {
      id: 'areas',
      header: 'Areas',
      align: 'right',
      cell: (b) => (b.kind === 'headquarters' ? '—' : b.areas.length),
    },
    { id: 'staff', header: 'Staff', align: 'right', cell: (b) => b.staffCount },
    { id: 'customers', header: 'Customers', align: 'right', cell: (b) => b.customerCount },
    { id: 'status', header: 'Status', cell: (b) => <StatusBadge status={b.status} /> },
  ]
  return (
    <>
      <PageHeader
        title="Branches"
        description="The two-digit code starts every account number in the branch, so it can’t change once accounts exist."
        actions={
          <Button
            variant="primary"
            icon={<Plus className="size-4" aria-hidden />}
            onClick={() => setEditing('new')}
          >
            Add branch
          </Button>
        }
      />
      <DataTable
        caption="Branches"
        columns={columns}
        rows={query.data?.results
          .slice()
          .sort((a, b) => Number(b.kind === 'headquarters') - Number(a.kind === 'headquarters'))}
        getRowId={(b) => b.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={setEditing}
        density="comfortable"
        empty={{ title: 'No branches yet', description: 'Add the first branch.' }}
      />
      {editing && (
        <BranchDialog
          branch={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

function BranchDialog({ branch, onClose }: { branch: Branch | null; onClose: () => void }) {
  const [v, setV] = useState<BranchInput>({
    name: branch?.name ?? '',
    code: branch?.code ?? '',
    address: branch?.address ?? '',
    phone: branch?.phone ?? '',
    areas: branch?.areas ?? [],
    managerId: branch?.managerId ?? null,
    status: branch?.status ?? 'active',
  })
  const [area, setArea] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()
  const toast = useToast()
  // Headquarters is run by the general manager and holds no collection areas.
  const isHq = branch?.kind === 'headquarters'
  const managerRole = isHq ? 'general_manager' : 'branch_manager'
  const managers = useQuery({
    queryKey: staffKeys.list({ role: managerRole, pageSize: 100 }),
    queryFn: () => staffApi.list({ role: managerRole, pageSize: 100 }),
  })
  const set =
    (k: keyof BranchInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setV((x) => ({ ...x, [k]: e.target.value || (k === 'managerId' ? null : '') }))
  const addArea = () => {
    const a = area.trim()
    if (a && !v.areas.includes(a)) setV((x) => ({ ...x, areas: [...x.areas, a] }))
    setArea('')
  }

  const submit = async () => {
    setBusy(true)
    setErrors({})
    setFormError(null)
    try {
      const saved = branch
        ? await branchAdminApi.update(branch.id, v)
        : await branchAdminApi.create(v)
      await queryClient.invalidateQueries({ queryKey: branchKeys.all })
      toast({ title: branch ? 'Branch updated' : 'Branch added', description: saved.name })
      onClose()
    } catch (e) {
      if (isApiError(e)) {
        setErrors(
          Object.fromEntries(Object.entries(e.fieldErrors).map(([k, val]) => [k, val.join(' ')])),
        )
        setFormError(e.formErrors.join(' ') || null)
      } else setFormError('Not saved. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      title={branch ? `Edit ${branch.name}` : 'Add a branch'}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {branch ? 'Save branch' : 'Add branch'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {formError && (
          <Alert tone="danger" className="sm:col-span-2">
            {formError}
          </Alert>
        )}
        <TextInput label="Branch name" value={v.name} onChange={set('name')} error={errors.name} />
        <TextInput
          label="Code"
          inputMode="numeric"
          maxLength={2}
          className="font-mono"
          value={v.code}
          onChange={set('code')}
          error={errors.code}
          disabled={isHq}
          hint={isHq ? '00 is reserved for headquarters.' : 'Two digits, e.g. 06.'}
        />
        <TextInput
          label="Address"
          containerClassName="sm:col-span-2"
          value={v.address}
          onChange={set('address')}
          error={errors.address}
        />
        <TextInput
          label="Phone"
          type="tel"
          value={v.phone}
          onChange={set('phone')}
          error={errors.phone}
        />
        <Select
          label={isHq ? 'General manager' : 'Branch manager'}
          optional
          value={v.managerId ?? ''}
          onChange={set('managerId')}
          error={errors.managerId}
        >
          <option value="">No manager yet</option>
          {managers.data?.results.map((m) => (
            <option key={m.id} value={m.id}>
              {m.firstName} {m.lastName} ({m.branchName ?? 'head office'})
            </option>
          ))}
        </Select>
        {isHq ? (
          <Alert tone="info" className="sm:col-span-2">
            Headquarters oversees every branch. It has no collection areas or customers and can’t be
            closed.
          </Alert>
        ) : (
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-sm font-medium">Collection areas</p>
            <ul className="mb-2 flex flex-wrap gap-2">
              {v.areas.map((a) => (
                <li
                  key={a}
                  className="bg-ink-tint inline-flex items-center gap-1 rounded-sm py-1 pr-1 pl-2.5 text-sm"
                >
                  {a}
                  <button
                    type="button"
                    onClick={() => setV((x) => ({ ...x, areas: x.areas.filter((y) => y !== a) }))}
                    className="hover:bg-rule rounded p-0.5"
                    aria-label={`Remove ${a}`}
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </li>
              ))}
              {v.areas.length === 0 && <li className="text-ink-2 text-sm">None yet.</li>}
            </ul>
            <div className="flex items-end gap-2">
              <TextInput
                label="Add an area"
                hideLabel
                placeholder="e.g. Egbeda Market"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addArea()
                  }
                }}
                containerClassName="flex-1"
              />
              <Button onClick={addArea} disabled={!area.trim()}>
                Add area
              </Button>
            </div>
            {errors.areas && <p className="text-brick mt-1 text-sm font-medium">{errors.areas}</p>}
          </div>
        )}
        {branch && !isHq && (
          <Select label="Status" value={v.status} onChange={set('status')} error={errors.status}>
            <option value="active">Active</option>
            <option value="inactive">Closed</option>
          </Select>
        )}
      </div>
    </Dialog>
  )
}
