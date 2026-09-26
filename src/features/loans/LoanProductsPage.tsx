import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { isApiError } from '@/api/client'
import { loanProductKeys, loanProductsApi, type LoanProductInput } from '@/api/loans'
import { DataTable, type Column } from '@/components/data/DataTable'
import { MoneyInput } from '@/components/form/MoneyInput'
import { Checkbox, Select, TextInput } from '@/components/form/inputs'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useToast } from '@/components/ui/Toast'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { buildSchedule } from '@/lib/loans'
import { formatNaira, naira, type Kobo } from '@/lib/money'
import { hasPermission } from '@/lib/permissions'
import type { InterestMethod, LoanProduct, RepaymentFrequency } from '@/types'

export const FREQUENCY_UNIT: Record<RepaymentFrequency, [string, string]> = {
  daily: ['day', 'days'],
  weekly: ['week', 'weeks'],
  monthly: ['month', 'months'],
}

export function tenorLabel(count: number, frequency: RepaymentFrequency) {
  const [one, many] = FREQUENCY_UNIT[frequency]
  return `${count} ${count === 1 ? one : many}`
}

export function LoanProductsPage() {
  const user = useCurrentUser()
  const canManage = hasPermission(user, 'loan_products.manage')
  const [editing, setEditing] = useState<LoanProduct | 'new' | null>(null)
  const query = useQuery({
    queryKey: loanProductKeys.list(),
    queryFn: () => loanProductsApi.list(),
  })

  const columns: Column<LoanProduct>[] = [
    { id: 'name', header: 'Product', cell: (p) => <span className="font-medium">{p.name}</span> },
    {
      id: 'freq',
      header: 'Repayment',
      cell: (p) => p.repaymentFrequency[0]!.toUpperCase() + p.repaymentFrequency.slice(1),
    },
    {
      id: 'rate',
      header: 'Interest',
      cell: (p) =>
        `${p.monthlyRatePercent}% a month, ${p.interestMethod === 'flat' ? 'flat' : 'reducing balance'}`,
    },
    {
      id: 'range',
      header: 'Amount',
      cell: (p) =>
        `${formatNaira(p.minAmount, { trimZeroKobo: true })} – ${formatNaira(p.maxAmount, { trimZeroKobo: true })}`,
    },
    {
      id: 'tenor',
      header: 'Tenor',
      cell: (p) => `${p.minTenor}–${tenorLabel(p.maxTenor, p.repaymentFrequency)}`,
    },
    { id: 'fee', header: 'Fee', align: 'right', cell: (p) => `${p.processingFeePercent}%` },
    {
      id: 'penalty',
      header: 'Late penalty',
      cell: (p) =>
        `${p.penalty.percentPerDay}% a day after ${p.penalty.graceDays} days, up to ${p.penalty.capPercent}%`,
    },
    { id: 'status', header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
  ]

  return (
    <>
      <PageHeader
        title="Loan products"
        description="Terms officers can offer. Changing a product only affects new applications; existing loans keep their terms."
        actions={
          canManage && (
            <Button
              variant="primary"
              icon={<Plus className="size-4" aria-hidden />}
              onClick={() => setEditing('new')}
            >
              New product
            </Button>
          )
        }
      />
      <DataTable
        caption="Loan products"
        columns={columns}
        rows={query.data?.results}
        getRowId={(p) => p.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={canManage ? setEditing : undefined}
        density="comfortable"
        empty={{
          title: 'No loan products yet',
          description: canManage
            ? 'Create one with “New product”.'
            : 'An administrator needs to set up loan products.',
        }}
      />
      {editing && (
        <ProductDialog
          product={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

function ProductDialog({ product, onClose }: { product: LoanProduct | null; onClose: () => void }) {
  const [form, setForm] = useState({
    name: product?.name ?? '',
    interestMethod: product?.interestMethod ?? ('flat' as InterestMethod),
    monthlyRatePercent: product?.monthlyRatePercent ?? '4.00',
    repaymentFrequency: product?.repaymentFrequency ?? ('weekly' as RepaymentFrequency),
    minTenor: String(product?.minTenor ?? 8),
    maxTenor: String(product?.maxTenor ?? 24),
    processingFeePercent: product?.processingFeePercent ?? '2.00',
    percentPerDay: product?.penalty.percentPerDay ?? '1.00',
    graceDays: String(product?.penalty.graceDays ?? 3),
    capPercent: product?.penalty.capPercent ?? '25.00',
    requiresGuarantor: product?.requiresGuarantor ?? true,
    status: product?.status ?? ('active' as LoanProduct['status']),
  })
  const [minAmount, setMinAmount] = useState<Kobo | null>(product?.minAmount ?? naira(100_000))
  const [maxAmount, setMaxAmount] = useState<Kobo | null>(product?.maxAmount ?? naira(1_000_000))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()
  const toast = useToast()
  const set =
    (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }))

  // Worked example so the admin sees what the terms mean in naira.
  const example = (() => {
    const count = Number(form.minTenor)
    const principal = minAmount
    if (
      !principal ||
      !Number.isInteger(count) ||
      count < 1 ||
      !(Number(form.monthlyRatePercent) >= 0)
    )
      return null
    const q = buildSchedule(
      {
        principal,
        monthlyRatePercent: form.monthlyRatePercent,
        interestMethod: form.interestMethod,
        frequency: form.repaymentFrequency,
        installmentCount: count,
      },
      '2026-01-05',
    )
    return `Borrowing ${formatNaira(principal, { trimZeroKobo: true })} over ${tenorLabel(count, form.repaymentFrequency)}: ${formatNaira(q.installment)} each ${FREQUENCY_UNIT[form.repaymentFrequency][0]}, ${formatNaira(q.interest)} interest in total.`
  })()

  const submit = async () => {
    if (!minAmount || !maxAmount) {
      setErrors({
        minAmount: minAmount ? '' : 'Enter the smallest amount.',
        maxAmount: maxAmount ? '' : 'Enter the largest amount.',
      })
      return
    }
    const input: LoanProductInput = {
      name: form.name.trim(),
      interestMethod: form.interestMethod,
      monthlyRatePercent: form.monthlyRatePercent,
      repaymentFrequency: form.repaymentFrequency,
      minTenor: Number(form.minTenor),
      maxTenor: Number(form.maxTenor),
      minAmount,
      maxAmount,
      processingFeePercent: form.processingFeePercent,
      penalty: {
        percentPerDay: form.percentPerDay,
        graceDays: Number(form.graceDays),
        capPercent: form.capPercent,
      },
      requiresGuarantor: form.requiresGuarantor,
      status: form.status,
    }
    setBusy(true)
    setErrors({})
    setFormError(null)
    try {
      const saved = product
        ? await loanProductsApi.update(product.id, input)
        : await loanProductsApi.create(input)
      await queryClient.invalidateQueries({ queryKey: loanProductKeys.all })
      toast({ title: product ? 'Product updated' : 'Product created', description: saved.name })
      onClose()
    } catch (e) {
      if (isApiError(e)) {
        setErrors(
          Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, v.join(' ')])),
        )
        setFormError(
          e.formErrors.join(' ') || (Object.keys(e.fieldErrors).length ? null : e.message),
        )
      } else setFormError('The product was not saved. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      size="lg"
      title={product ? `Edit ${product.name}` : 'New loan product'}
      description={product ? 'Loans already given keep the terms they were given on.' : undefined}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {product ? 'Save product' : 'Create product'}
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
          label="Product name"
          containerClassName="sm:col-span-2"
          value={form.name}
          onChange={set('name')}
          error={errors.name}
          placeholder="e.g. Weekly trader loan"
        />
        <Select
          label="Repayment"
          value={form.repaymentFrequency}
          onChange={set('repaymentFrequency')}
          error={errors.repaymentFrequency}
        >
          <option value="daily">Daily (working days)</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </Select>
        <Select
          label="Interest method"
          value={form.interestMethod}
          onChange={set('interestMethod')}
          error={errors.interestMethod}
        >
          <option value="flat">Flat (on the original amount)</option>
          <option value="reducing_balance">Reducing balance</option>
        </Select>
        <TextInput
          label="Interest rate (% a month)"
          inputMode="decimal"
          value={form.monthlyRatePercent}
          onChange={set('monthlyRatePercent')}
          error={errors.monthlyRatePercent}
        />
        <TextInput
          label="Processing fee (%)"
          inputMode="decimal"
          value={form.processingFeePercent}
          onChange={set('processingFeePercent')}
          error={errors.processingFeePercent}
          hint="Deducted from the amount paid out."
        />
        <MoneyInput
          label="Smallest amount"
          value={minAmount}
          onChange={setMinAmount}
          error={errors.minAmount}
        />
        <MoneyInput
          label="Largest amount"
          value={maxAmount}
          onChange={setMaxAmount}
          error={errors.maxAmount}
        />
        <TextInput
          label="Fewest installments"
          inputMode="numeric"
          value={form.minTenor}
          onChange={set('minTenor')}
          error={errors.minTenor}
        />
        <TextInput
          label="Most installments"
          inputMode="numeric"
          value={form.maxTenor}
          onChange={set('maxTenor')}
          error={errors.maxTenor}
        />
        <fieldset className="border-rule grid gap-4 rounded border p-4 sm:col-span-2 sm:grid-cols-3">
          <legend className="px-1 text-sm font-semibold">Late payment penalty</legend>
          <TextInput
            label="% of arrears a day"
            inputMode="decimal"
            value={form.percentPerDay}
            onChange={set('percentPerDay')}
            error={errors['penalty.percentPerDay']}
          />
          <TextInput
            label="Grace days"
            inputMode="numeric"
            value={form.graceDays}
            onChange={set('graceDays')}
            error={errors['penalty.graceDays']}
          />
          <TextInput
            label="Stop at (% of arrears)"
            inputMode="decimal"
            value={form.capPercent}
            onChange={set('capPercent')}
            error={errors['penalty.capPercent']}
          />
        </fieldset>
        <Select label="Status" value={form.status} onChange={set('status')} error={errors.status}>
          <option value="active">Active</option>
          <option value="retired">Retired</option>
        </Select>
        <div className="flex items-end">
          <Checkbox
            label="Needs at least one guarantor"
            checked={form.requiresGuarantor}
            onChange={(e) => setForm((f) => ({ ...f, requiresGuarantor: e.target.checked }))}
          />
        </div>
        {example && <p className="bg-paper rounded px-3 py-2 text-sm sm:col-span-2">{example}</p>}
      </div>
    </Dialog>
  )
}
