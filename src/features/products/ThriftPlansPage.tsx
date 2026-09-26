import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { isApiError } from '@/api/client'
import { thriftPlanKeys, thriftPlansApi } from '@/api/thriftPlans'
import { DataTable, type Column } from '@/components/data/DataTable'
import { MoneyInput } from '@/components/form/MoneyInput'
import { Checkbox, Select, TextInput } from '@/components/form/inputs'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Money } from '@/components/ui/display'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useToast } from '@/components/ui/Toast'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { formatNaira, kobo, naira, type Kobo } from '@/lib/money'
import { hasPermission } from '@/lib/permissions'
import type { CommissionRule, ThriftPlan, ThriftPlanInput } from '@/types'

export function describeCommission(c: CommissionRule): string {
  if (c.type === 'first_contribution') return 'First contribution of each cycle'
  if (c.type === 'percentage') return `${c.percent}% of each contribution`
  return `${formatNaira(c.amount)} per cycle`
}

/** What a saver gets back from one full cycle, after the fee. */
export function cyclePayout(
  p: Pick<ThriftPlan, 'contributionAmount' | 'cycleLength' | 'commission'>,
): Kobo {
  const gross = p.contributionAmount * p.cycleLength
  const fee =
    p.commission.type === 'first_contribution'
      ? p.contributionAmount
      : p.commission.type === 'percentage'
        ? Math.round((gross * Number(p.commission.percent)) / 100)
        : p.commission.amount
  return kobo(Math.max(0, gross - fee))
}

export function ThriftPlansPage() {
  const user = useCurrentUser()
  const canManage = hasPermission(user, 'thrift_plans.manage')
  const [editing, setEditing] = useState<ThriftPlan | 'new' | null>(null)
  const query = useQuery({ queryKey: thriftPlanKeys.list(), queryFn: () => thriftPlansApi.list() })

  const columns: Column<ThriftPlan>[] = [
    { id: 'name', header: 'Plan', cell: (p) => <span className="font-medium">{p.name}</span> },
    { id: 'code', header: 'Code', cell: (p) => <span className="font-mono">{p.code}</span> },
    {
      id: 'freq',
      header: 'Frequency',
      cell: (p) => (p.frequency === 'daily' ? 'Daily' : 'Weekly'),
    },
    {
      id: 'amount',
      header: 'Contribution',
      align: 'right',
      cell: (p) => <Money value={p.contributionAmount} />,
    },
    {
      id: 'cycle',
      header: 'Cycle',
      align: 'right',
      cell: (p) => `${p.cycleLength} ${p.frequency === 'daily' ? 'days' : 'weeks'}`,
    },
    { id: 'fee', header: 'Collection fee', cell: (p) => describeCommission(p.commission) },
    {
      id: 'payout',
      header: 'Payout per cycle',
      align: 'right',
      cell: (p) => <Money value={cyclePayout(p)} />,
    },
    { id: 'status', header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
  ]

  return (
    <>
      <PageHeader
        title="Thrift plans"
        description="The savings plans officers collect for. Retired plans stay on existing accounts but can't be chosen for new ones."
        actions={
          canManage && (
            <Button
              variant="primary"
              icon={<Plus className="size-4" aria-hidden />}
              onClick={() => setEditing('new')}
            >
              New plan
            </Button>
          )
        }
      />
      <DataTable
        caption="Thrift plans"
        columns={columns}
        rows={query.data?.results}
        getRowId={(p) => p.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={canManage ? setEditing : undefined}
        density="comfortable"
        empty={{
          title: 'No thrift plans yet',
          description: canManage
            ? 'Create the first plan with “New plan”.'
            : 'An administrator needs to create thrift plans.',
        }}
      />
      {editing && (
        <PlanDialog plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </>
  )
}

function PlanDialog({ plan, onClose }: { plan: ThriftPlan | null; onClose: () => void }) {
  const [name, setName] = useState(plan?.name ?? '')
  const [frequency, setFrequency] = useState<ThriftPlan['frequency']>(plan?.frequency ?? 'daily')
  const [amount, setAmount] = useState<Kobo | null>(plan?.contributionAmount ?? null)
  const [cycle, setCycle] = useState(String(plan?.cycleLength ?? 31))
  const [commissionType, setCommissionType] = useState<CommissionRule['type']>(
    plan?.commission.type ?? 'first_contribution',
  )
  const [percent, setPercent] = useState(
    plan?.commission.type === 'percentage' ? plan.commission.percent : '3.00',
  )
  const [flat, setFlat] = useState<Kobo | null>(
    plan?.commission.type === 'flat' ? plan.commission.amount : naira(500),
  )
  const [misses, setMisses] = useState(String(plan?.allowedMisses ?? 3))
  const [early, setEarly] = useState(plan?.earlyWithdrawalAllowed ?? false)
  const [status, setStatus] = useState<ThriftPlan['status']>(plan?.status ?? 'active')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()
  const toast = useToast()

  const commission: CommissionRule =
    commissionType === 'percentage'
      ? { type: 'percentage', percent }
      : commissionType === 'flat'
        ? { type: 'flat', amount: flat ?? kobo(0) }
        : { type: 'first_contribution' }

  const submit = async () => {
    if (!amount) {
      setErrors({ contributionAmount: 'Enter the contribution amount.' })
      return
    }
    const input: ThriftPlanInput = {
      name: name.trim(),
      frequency,
      contributionAmount: amount,
      cycleLength: Number(cycle),
      commission,
      allowedMisses: Number(misses),
      earlyWithdrawalAllowed: early,
      status,
    }
    setBusy(true)
    setErrors({})
    setFormError(null)
    try {
      const saved = plan
        ? await thriftPlansApi.update(plan.id, input)
        : await thriftPlansApi.create(input)
      await queryClient.invalidateQueries({ queryKey: thriftPlanKeys.all })
      toast({ title: plan ? 'Plan updated' : 'Plan created', description: saved.name })
      onClose()
    } catch (e) {
      if (isApiError(e)) {
        setErrors(
          Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, v.join(' ')])),
        )
        setFormError(e.formErrors.join(' ') || null)
      } else setFormError('The plan was not saved. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const preview = amount
    ? cyclePayout({ contributionAmount: amount, cycleLength: Number(cycle) || 0, commission })
    : null

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      title={plan ? `Edit ${plan.name}` : 'New thrift plan'}
      description={
        plan ? 'Changes apply to future collections on every account in this plan.' : undefined
      }
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {plan ? 'Save plan' : 'Create plan'}
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
        <TextInput
          label="Plan name"
          containerClassName="sm:col-span-2"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
          placeholder="e.g. Daily ₦1,000"
        />
        <Select
          label="Frequency"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as ThriftPlan['frequency'])}
          error={errors.frequency}
        >
          <option value="daily">Daily (working days)</option>
          <option value="weekly">Weekly</option>
        </Select>
        <MoneyInput
          label="Contribution"
          value={amount}
          onChange={setAmount}
          error={errors.contributionAmount}
        />
        <TextInput
          label="Cycle length"
          inputMode="numeric"
          value={cycle}
          onChange={(e) => setCycle(e.target.value.replace(/\D/g, ''))}
          hint={
            frequency === 'daily'
              ? 'Number of daily contributions, e.g. 31.'
              : 'Number of weekly contributions, e.g. 13.'
          }
          error={errors.cycleLength}
        />
        <TextInput
          label="Missed contributions allowed"
          inputMode="numeric"
          value={misses}
          onChange={(e) => setMisses(e.target.value.replace(/\D/g, ''))}
          hint="Before the payout is held back."
          error={errors.allowedMisses}
        />
        <Select
          label="Collection fee"
          value={commissionType}
          onChange={(e) => setCommissionType(e.target.value as CommissionRule['type'])}
          error={errors['commission.type']}
        >
          <option value="first_contribution">First contribution of each cycle</option>
          <option value="percentage">Percentage of each contribution</option>
          <option value="flat">Flat fee per cycle</option>
        </Select>
        {commissionType === 'percentage' && (
          <TextInput
            label="Percentage"
            inputMode="decimal"
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            error={errors['commission.percent']}
          />
        )}
        {commissionType === 'flat' && (
          <MoneyInput
            label="Flat fee"
            value={flat}
            onChange={setFlat}
            error={errors['commission.amount']}
          />
        )}
        {commissionType === 'first_contribution' && <div />}
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as ThriftPlan['status'])}
          error={errors.status}
        >
          <option value="active">Active</option>
          <option value="retired">Retired</option>
        </Select>
        <div className="flex items-end">
          <Checkbox
            label="Allow early withdrawal"
            checked={early}
            onChange={(e) => setEarly(e.target.checked)}
          />
        </div>
        {preview !== null && (
          <p className="bg-paper rounded px-3 py-2 text-sm sm:col-span-2">
            A saver who pays every time gets{' '}
            <strong className="tabular">{formatNaira(preview)}</strong> at the end of the cycle.
          </p>
        )}
      </div>
    </Dialog>
  )
}
