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
import { SegmentedControl, Tabs } from '@/components/ui/Tabs'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useToast } from '@/components/ui/Toast'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { buildSchedule, describeFee, describeInterest, describePenalty } from '@/lib/loans'
import { formatNaira, naira, type Kobo } from '@/lib/money'
import { hasPermission } from '@/lib/permissions'
import type {
  FeeRule,
  InterestBasis,
  InterestMethod,
  LoanKind,
  LoanProduct,
  PenaltyRule,
  RepaymentFrequency,
} from '@/types'

export const FREQUENCY_UNIT: Record<RepaymentFrequency, [string, string]> = {
  daily: ['day', 'days'],
  weekly: ['week', 'weeks'],
  monthly: ['month', 'months'],
}

export function tenorLabel(count: number, frequency: RepaymentFrequency) {
  const [one, many] = FREQUENCY_UNIT[frequency]
  return `${count} ${count === 1 ? one : many}`
}

export const KIND_LABEL: Record<LoanKind, string> = {
  cash: 'Cash loans',
  bnpl: 'Buy now pay later',
}

const money = (k: Kobo) => formatNaira(k, { trimZeroKobo: true })

export function LoanProductsPage() {
  const user = useCurrentUser()
  const canManage = hasPermission(user, 'loan_products.manage')
  const [kind, setKind] = useState<LoanKind>('cash')
  const [editing, setEditing] = useState<LoanProduct | 'new' | null>(null)
  const query = useQuery({
    queryKey: loanProductKeys.list(),
    queryFn: () => loanProductsApi.list(),
  })

  const all = query.data?.results
  const rows = all?.filter((p) => p.kind === kind)
  const count = (k: LoanKind) => all?.filter((p) => p.kind === k).length

  const columns: Column<LoanProduct>[] = [
    { id: 'name', header: 'Product', cell: (p) => <span className="font-medium">{p.name}</span> },
    {
      id: 'freq',
      header: 'Repayment',
      cell: (p) => p.repaymentFrequency[0]!.toUpperCase() + p.repaymentFrequency.slice(1),
    },
    { id: 'rate', header: 'Interest', cell: (p) => describeInterest(p) },
    {
      id: 'range',
      header: kind === 'bnpl' ? 'Item price' : 'Amount',
      cell: (p) => `${money(p.minAmount)} – ${money(p.maxAmount)}`,
    },
    {
      id: 'tenor',
      header: 'Tenor',
      cell: (p) => `${p.minTenor}–${tenorLabel(p.maxTenor, p.repaymentFrequency)}`,
    },
    {
      id: 'fee',
      header: 'Processing fee',
      cell: (p) => describeFee(p.processingFee, money),
    },
    {
      id: 'penalty',
      header: 'Late penalty',
      cell: (p) => describePenalty(p.penalty, money),
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
      <Tabs
        label="Loan product type"
        value={kind}
        onChange={setKind}
        items={[
          { value: 'cash', label: KIND_LABEL.cash, count: count('cash') },
          { value: 'bnpl', label: KIND_LABEL.bnpl, count: count('bnpl') },
        ]}
      />
      <p className="text-ink-2 my-3 text-sm">
        {kind === 'cash'
          ? 'The customer receives money and repays it in installments.'
          : 'The company buys the item for the customer, who repays the price plus interest in installments.'}
      </p>
      <DataTable
        caption={KIND_LABEL[kind]}
        columns={columns}
        rows={rows}
        getRowId={(p) => p.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={canManage ? setEditing : undefined}
        density="comfortable"
        empty={{
          title:
            kind === 'cash' ? 'No cash loan products yet' : 'No buy now pay later products yet',
          description: canManage
            ? 'Create one with “New product”.'
            : 'An administrator needs to set up loan products.',
        }}
      />
      {editing && (
        <ProductDialog
          product={editing === 'new' ? null : editing}
          initialKind={kind}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

function ProductDialog({
  product,
  initialKind,
  onClose,
}: {
  product: LoanProduct | null
  initialKind: LoanKind
  onClose: () => void
}) {
  const [kind, setKind] = useState<LoanKind>(product?.kind ?? initialKind)
  const bnpl = kind === 'bnpl'
  const [form, setForm] = useState({
    name: product?.name ?? '',
    interestMethod: product?.interestMethod ?? ('flat' as InterestMethod),
    interestBasis: product?.interestBasis ?? ('monthly' as InterestBasis),
    ratePercent: product?.ratePercent ?? '4.00',
    repaymentFrequency: product?.repaymentFrequency ?? ('weekly' as RepaymentFrequency),
    minTenor: String(product?.minTenor ?? 8),
    maxTenor: String(product?.maxTenor ?? 24),
    feeType: product?.processingFee.type ?? ('percentage' as FeeRule['type']),
    feePercent:
      product?.processingFee.type === 'percentage' ? product.processingFee.percent : '2.00',
    penaltyType: product?.penalty.type ?? ('percentage' as PenaltyRule['type']),
    percentPerDay: product?.penalty.type === 'percentage' ? product.penalty.percentPerDay : '1.00',
    graceDays: String(product?.penalty.graceDays ?? 3),
    capPercent: product?.penalty.capPercent ?? '25.00',
    requiresGuarantor: product?.requiresGuarantor ?? true,
    status: product?.status ?? ('active' as LoanProduct['status']),
  })
  const [feeFlat, setFeeFlat] = useState<Kobo | null>(
    product?.processingFee.type === 'flat' ? product.processingFee.amount : naira(2_000),
  )
  const [penaltyFlat, setPenaltyFlat] = useState<Kobo | null>(
    product?.penalty.type === 'flat' ? product.penalty.amountPerDay : naira(200),
  )
  const [minAmount, setMinAmount] = useState<Kobo | null>(
    product?.minAmount ?? naira(bnpl ? 50_000 : 100_000),
  )
  const [maxAmount, setMaxAmount] = useState<Kobo | null>(
    product?.maxAmount ?? naira(bnpl ? 1_500_000 : 1_000_000),
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()
  const toast = useToast()
  const set =
    (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }))

  const overall = form.interestBasis === 'overall'
  // An overall rate is one charge on the amount, so it is always flat.
  const interestMethod: InterestMethod = overall ? 'flat' : form.interestMethod
  const thing = bnpl ? 'item' : 'loan'

  // Worked example so the admin sees what the terms mean in naira.
  const example = (() => {
    const count = Number(form.minTenor)
    const principal = minAmount
    if (!principal || !Number.isInteger(count) || count < 1 || !(Number(form.ratePercent) >= 0))
      return null
    const q = buildSchedule(
      {
        principal,
        ratePercent: form.ratePercent,
        interestBasis: form.interestBasis,
        interestMethod,
        frequency: form.repaymentFrequency,
        installmentCount: count,
      },
      '2026-01-05',
    )
    return `${bnpl ? 'An item costing' : 'Borrowing'} ${money(principal)} over ${tenorLabel(count, form.repaymentFrequency)}: ${formatNaira(q.installment)} each ${FREQUENCY_UNIT[form.repaymentFrequency][0]}, ${formatNaira(q.interest)} interest in total.`
  })()

  const submit = async () => {
    const local: Record<string, string> = {}
    if (!minAmount)
      local.minAmount = bnpl ? 'Enter the lowest item price.' : 'Enter the smallest amount.'
    if (!maxAmount)
      local.maxAmount = bnpl ? 'Enter the highest item price.' : 'Enter the largest amount.'
    if (form.feeType === 'flat' && !feeFlat) local['processingFee.amount'] = 'Enter the fee amount.'
    if (form.penaltyType === 'flat' && !penaltyFlat)
      local['penalty.amountPerDay'] = 'Enter the daily penalty amount.'
    if (Object.keys(local).length) {
      setErrors(local)
      return
    }
    const processingFee: FeeRule =
      form.feeType === 'none'
        ? { type: 'none' }
        : form.feeType === 'flat'
          ? { type: 'flat', amount: feeFlat! }
          : { type: 'percentage', percent: form.feePercent }
    const penaltyBase = { graceDays: Number(form.graceDays), capPercent: form.capPercent }
    const penalty: PenaltyRule =
      form.penaltyType === 'flat'
        ? { ...penaltyBase, type: 'flat', amountPerDay: penaltyFlat! }
        : { ...penaltyBase, type: 'percentage', percentPerDay: form.percentPerDay }
    const input: LoanProductInput = {
      name: form.name.trim(),
      kind,
      interestMethod,
      interestBasis: form.interestBasis,
      ratePercent: form.ratePercent,
      repaymentFrequency: form.repaymentFrequency,
      minTenor: Number(form.minTenor),
      maxTenor: Number(form.maxTenor),
      minAmount: minAmount!,
      maxAmount: maxAmount!,
      processingFee,
      penalty,
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
      title={
        product ? `Edit ${product.name}` : `New ${bnpl ? 'buy now pay later' : 'cash loan'} product`
      }
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
        {!product && (
          <div className="sm:col-span-2">
            <SegmentedControl
              label="Product type"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'cash', label: 'Cash loan' },
                { value: 'bnpl', label: 'Buy now pay later' },
              ]}
            />
          </div>
        )}
        <p className="text-ink-2 text-sm sm:col-span-2">
          {bnpl
            ? 'The company buys the item for the customer, who then repays the price plus interest.'
            : 'The customer receives money and repays it with interest.'}
        </p>
        <TextInput
          label="Product name"
          containerClassName="sm:col-span-2"
          value={form.name}
          onChange={set('name')}
          error={errors.name}
          placeholder={bnpl ? 'e.g. Phone and appliance plan' : 'e.g. Weekly trader loan'}
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
          label="Interest rate applies"
          value={form.interestBasis}
          onChange={set('interestBasis')}
          error={errors.interestBasis}
        >
          <option value="monthly">Monthly (every month the {thing} runs)</option>
          <option value="overall">Overall (once, for the whole {thing})</option>
        </Select>
        <TextInput
          label={overall ? 'Interest rate (% overall)' : 'Interest rate (% a month)'}
          inputMode="decimal"
          value={form.ratePercent}
          onChange={set('ratePercent')}
          error={errors.ratePercent}
          hint={
            overall
              ? `Charged once on the ${bnpl ? 'item price' : 'amount'}, however long it runs.`
              : undefined
          }
        />
        {overall ? (
          <p className="text-ink-2 self-end pb-2 text-sm">
            An overall rate is charged flat and shared equally across the installments.
          </p>
        ) : (
          <Select
            label="Interest method"
            value={form.interestMethod}
            onChange={set('interestMethod')}
            error={errors.interestMethod}
          >
            <option value="flat">Flat (on the original amount)</option>
            <option value="reducing_balance">Reducing balance</option>
          </Select>
        )}
        <MoneyInput
          label={bnpl ? 'Lowest item price' : 'Smallest amount'}
          value={minAmount}
          onChange={setMinAmount}
          error={errors.minAmount}
        />
        <MoneyInput
          label={bnpl ? 'Highest item price' : 'Largest amount'}
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
        <fieldset className="border-rule grid gap-4 rounded border p-4 sm:col-span-2 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold">Processing fee</legend>
          <Select
            label="Fee type"
            value={form.feeType}
            onChange={set('feeType')}
            error={errors.processingFee}
          >
            <option value="percentage">Percentage of the {bnpl ? 'item price' : 'amount'}</option>
            <option value="flat">Flat fee</option>
            <option value="none">None</option>
          </Select>
          {form.feeType === 'percentage' && (
            <TextInput
              label="Fee (%)"
              inputMode="decimal"
              value={form.feePercent}
              onChange={set('feePercent')}
              error={errors['processingFee.percent']}
            />
          )}
          {form.feeType === 'flat' && (
            <MoneyInput
              label="Fee amount"
              value={feeFlat}
              onChange={setFeeFlat}
              error={errors['processingFee.amount']}
            />
          )}
          <p className="text-ink-2 text-sm sm:col-span-2">
            {form.feeType === 'none'
              ? 'No processing fee is charged.'
              : bnpl
                ? 'The customer pays this when the item is handed over.'
                : 'Deducted from the amount paid out.'}
          </p>
        </fieldset>
        <fieldset className="border-rule grid gap-4 rounded border p-4 sm:col-span-2 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold">Late payment penalty (per day)</legend>
          <Select
            label="Penalty type"
            value={form.penaltyType}
            onChange={set('penaltyType')}
            error={errors['penalty.type']}
          >
            <option value="percentage">Percentage of arrears a day</option>
            <option value="flat">Flat fee a day</option>
          </Select>
          {form.penaltyType === 'percentage' ? (
            <TextInput
              label="% of arrears a day"
              inputMode="decimal"
              value={form.percentPerDay}
              onChange={set('percentPerDay')}
              error={errors['penalty.percentPerDay']}
            />
          ) : (
            <MoneyInput
              label="Amount a day"
              value={penaltyFlat}
              onChange={setPenaltyFlat}
              error={errors['penalty.amountPerDay']}
            />
          )}
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
