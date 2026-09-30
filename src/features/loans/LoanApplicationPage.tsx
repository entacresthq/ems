import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CircleCheck, CircleX, Plus, Trash2 } from 'lucide-react'
import { customerKeys, customersApi } from '@/api/customers'
import { isApiError } from '@/api/client'
import { loanKeys, loanProductKeys, loanProductsApi, loansApi } from '@/api/loans'
import { MoneyInput } from '@/components/form/MoneyInput'
import { Select, TextArea, TextInput } from '@/components/form/inputs'
import { SearchBox } from '@/components/data/Filters'
import { EmptyState, LoadingState } from '@/components/states'
import { Alert } from '@/components/ui/Alert'
import { Button, ButtonLink } from '@/components/ui/Button'
import { BackLink, Money, Panel } from '@/components/ui/display'
import { PageHeader } from '@/components/ui/PageHeader'
import { useToast } from '@/components/ui/Toast'
import { useBranchScope } from '@/features/organisation/BranchScope'
import { cn } from '@/lib/cn'
import { formatDate, todayIso } from '@/lib/dates'
import { buildSchedule, describeFee, describeInterest, processingFee } from '@/lib/loans'
import { formatNaira, kobo, type Kobo } from '@/lib/money'
import { formatPhone } from '@/lib/phone'
import type { Collateral, Customer, Loan } from '@/types'
import { tenorLabel } from './LoanProductsPage'

export function LoanApplicationPage() {
  const [params] = useSearchParams()
  const customerId = params.get('customer')
  const topUpId = params.get('topUp')
  const customer = useQuery({
    queryKey: customerKeys.detail(customerId ?? ''),
    queryFn: () => customersApi.get(customerId!),
    enabled: Boolean(customerId),
  })
  const topUp = useQuery({
    queryKey: loanKeys.detail(topUpId ?? ''),
    queryFn: () => loansApi.get(topUpId!),
    enabled: Boolean(topUpId),
  })

  return (
    <>
      <BackLink to={topUp.data ? `/loans/${topUp.data.id}` : '/loans'}>
        {topUp.data ? topUp.data.loanNumber : 'Loans'}
      </BackLink>
      <PageHeader
        title={topUpId ? 'Top-up loan application' : 'New loan application'}
        description={
          topUpId
            ? 'The new loan pays off what is left on the current loan. The customer receives the difference, less the processing fee.'
            : 'A second person must approve the loan before the cashier pays it out.'
        }
      />
      {!customerId ? (
        <CustomerPicker />
      ) : customer.isPending || (topUpId && topUp.isPending) ? (
        <LoadingState label="Loading customer…" />
      ) : customer.data ? (
        <ApplicationForm customer={customer.data} topUp={topUp.data ?? null} />
      ) : (
        <EmptyState
          title="Customer not found"
          action={<ButtonLink to="/loans/new">Choose another customer</ButtonLink>}
        />
      )}
    </>
  )
}

function CustomerPicker() {
  const { branchId } = useBranchScope()
  const [search, setSearch] = useState('')
  const params = {
    search: search || undefined,
    status: 'active' as const,
    pageSize: 10,
    branch: branchId ?? undefined,
  }
  const query = useQuery({
    queryKey: customerKeys.list(params),
    queryFn: () => customersApi.list(params),
    enabled: search.length >= 2,
  })
  return (
    <Panel title="1. Choose the customer" className="max-w-2xl">
      <SearchBox
        label="Search active customers"
        value={search}
        onChange={setSearch}
        placeholder="Name, phone, customer number or BVN"
        className="sm:max-w-none"
      />
      {search.length >= 2 && (
        <ul className="divide-rule border-rule mt-3 divide-y border-y">
          {query.isPending && <li className="text-ink-2 py-3 text-sm">Searching…</li>}
          {query.data?.results.length === 0 && (
            <li className="text-ink-2 py-3 text-sm">
              No active customer matches. Check the spelling or search by phone.
            </li>
          )}
          {query.data?.results.map((c) => (
            <li key={c.id}>
              <Link
                to={`/loans/new?customer=${c.id}`}
                className="hover:bg-paper flex items-center justify-between gap-3 px-1 py-2.5"
              >
                <span>
                  <span className="font-medium">
                    {c.firstName} {c.lastName}
                  </span>
                  <span className="text-ink-2 block text-sm">
                    <span className="font-mono">{c.customerNumber}</span> · {formatPhone(c.phone)} ·{' '}
                    {c.area}
                  </span>
                </span>
                <span className="text-sm font-medium underline">Choose</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li
      className={cn('flex items-start gap-2 text-sm', ok ? 'text-ink' : 'text-brick font-medium')}
    >
      {ok ? (
        <CircleCheck className="text-ledger mt-0.5 size-4 shrink-0" aria-hidden />
      ) : (
        <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden />
      )}
      <span>{children}</span>
    </li>
  )
}

function ApplicationForm({ customer, topUp }: { customer: Customer; topUp: Loan | null }) {
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const products = useQuery({
    queryKey: loanProductKeys.list('active'),
    queryFn: () => loanProductsApi.list('active'),
  })
  const [productId, setProductId] = useState(topUp?.productId ?? '')
  const [principal, setPrincipal] = useState<Kobo | null>(null)
  const [count, setCount] = useState('')
  const [purpose, setPurpose] = useState('')
  const [itemDescription, setItemDescription] = useState('')
  const [supplierName, setSupplierName] = useState('')
  const [collateral, setCollateral] = useState<
    (Omit<Collateral, 'estimatedValue'> & { estimatedValue: Kobo | null })[]
  >([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const product = products.data?.results.find((p) => p.id === productId)
  const bnpl = product?.kind === 'bnpl'

  const quote = useMemo(() => {
    const n = Number(count)
    if (!product || !principal || !Number.isInteger(n) || n < 1) return null
    const q = buildSchedule(
      {
        principal,
        ratePercent: product.ratePercent,
        interestBasis: product.interestBasis,
        interestMethod: product.interestMethod,
        frequency: product.repaymentFrequency,
        installmentCount: n,
      },
      todayIso(),
    )
    const fee = processingFee(principal, product.processingFee)
    const settle = topUp?.outstanding ?? kobo(0)
    // Cash loan: the customer gets the amount less fee. BNPL: the company pays
    // the supplier the full price and the customer pays the fee at handover.
    const payout = product.kind === 'bnpl' ? principal : kobo(principal - fee - settle)
    return { ...q, fee, settle, payout }
  }, [product, principal, count, topUp])

  const checks = [
    { ok: customer.status === 'active', text: 'Active customer' },
    {
      ok: Boolean(customer.bvn),
      text: customer.bvn ? 'BVN on record' : 'No BVN. Add it on the customer’s page first.',
    },
    {
      ok: Boolean(customer.nextOfKin),
      text: customer.nextOfKin ? 'Next of kin on record' : 'No next of kin. Add one first.',
    },
    {
      ok: !product?.requiresGuarantor || customer.guarantors.length > 0,
      text: customer.guarantors.length
        ? `${customer.guarantors.length} guarantor${customer.guarantors.length > 1 ? 's' : ''}: ${customer.guarantors.map((g) => g.fullName).join(', ')}`
        : 'No guarantor. This product needs one.',
    },
  ]
  const blocked = checks.some((c) => !c.ok)

  const submit = useMutation({
    mutationFn: () =>
      loansApi.apply({
        customerId: customer.id,
        productId,
        principal: principal!,
        installmentCount: Number(count),
        purpose: bnpl ? itemDescription.trim() : purpose,
        ...(bnpl
          ? { itemDescription: itemDescription.trim(), supplierName: supplierName.trim() }
          : {}),
        collateral: collateral.map((c) => ({ ...c, estimatedValue: c.estimatedValue ?? kobo(0) })),
        topUpOfId: topUp?.id ?? null,
      }),
    onSuccess: async (loan) => {
      await queryClient.invalidateQueries({ queryKey: ['loans'] })
      await queryClient.invalidateQueries({ queryKey: ['approvals'] })
      toast(
        loan.status === 'approved'
          ? {
              title: 'Loan approved',
              description: `${loan.loanNumber} for ${loan.customerName} was approved automatically. It is ready to pay out.`,
            }
          : {
              title: 'Application sent for approval',
              description: `${loan.loanNumber} for ${loan.customerName}.`,
            },
      )
      navigate(`/loans/${loan.id}`)
    },
    onError: (e) => {
      if (isApiError(e)) {
        setErrors(
          Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, v.join(' ')])),
        )
        setFormError(e.formErrors.join(' ') || e.fieldErrors.customerId?.join(' ') || null)
      } else setFormError('The application was not sent. Try again.')
    },
  })

  const validate = () => {
    const next: Record<string, string> = {}
    if (!productId) next.productId = 'Choose a loan product.'
    if (!principal) next.principal = 'Enter the amount.'
    else if (product && (principal < product.minAmount || principal > product.maxAmount)) {
      next.principal = `Between ${formatNaira(product.minAmount, { trimZeroKobo: true })} and ${formatNaira(product.maxAmount, { trimZeroKobo: true })}.`
    }
    const n = Number(count)
    if (product && (!Number.isInteger(n) || n < product.minTenor || n > product.maxTenor)) {
      next.installmentCount = `Between ${product.minTenor} and ${product.maxTenor} installments.`
    }
    if (bnpl) {
      if (itemDescription.trim().length < 3)
        next.itemDescription = 'Say what the company is buying.'
      if (supplierName.trim().length < 2) next.supplierName = 'Enter who the company will pay.'
    } else if (purpose.trim().length < 5) next.purpose = 'Say what the money is for.'
    if (!bnpl && quote && quote.payout <= 0)
      next.principal = 'The top-up must be more than the old balance plus the fee.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex flex-col gap-6">
        <Panel
          title="Customer"
          actions={
            !topUp && (
              <Link to="/loans/new" className="text-sm font-medium underline">
                Change
              </Link>
            )
          }
        >
          <p className="font-semibold">
            {customer.firstName} {customer.lastName}{' '}
            <span className="text-ink-2 font-mono text-sm font-normal">
              {customer.customerNumber}
            </span>
          </p>
          <p className="text-ink-2 text-sm">
            {customer.occupation} · {customer.area} · Officer {customer.officerName}
          </p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {checks.map((c) => (
              <Check key={c.text} ok={c.ok}>
                {c.text}
              </Check>
            ))}
          </ul>
          {blocked && (
            <p className="mt-3 text-sm">
              <Link to={`/customers/${customer.id}/edit`} className="font-medium underline">
                Update the customer’s details
              </Link>{' '}
              before applying.
            </p>
          )}
        </Panel>

        <Panel title="Loan terms">
          {formError && (
            <Alert tone="danger" className="mb-4">
              {formError}
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Loan product"
              value={productId}
              onChange={(e) => {
                setProductId(e.target.value)
                setCount('')
              }}
              error={errors.productId}
              disabled={Boolean(topUp)}
            >
              <option value="">{products.isPending ? 'Loading…' : 'Choose…'}</option>
              {(['cash', 'bnpl'] as const).map((kind) => {
                const group = products.data?.results.filter(
                  (p) => p.kind === kind && (!topUp || kind === 'cash'),
                )
                return group?.length ? (
                  <optgroup key={kind} label={kind === 'cash' ? 'Cash loans' : 'Buy now pay later'}>
                    {group.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {describeInterest(p)}
                      </option>
                    ))}
                  </optgroup>
                ) : null
              })}
            </Select>
            <MoneyInput
              label={bnpl ? 'Item price' : 'Amount'}
              value={principal}
              onChange={setPrincipal}
              error={errors.principal}
              hint={
                product
                  ? `${formatNaira(product.minAmount, { trimZeroKobo: true })} to ${formatNaira(product.maxAmount, { trimZeroKobo: true })}`
                  : undefined
              }
            />
            <TextInput
              label={
                product
                  ? `Number of ${product.repaymentFrequency} installments`
                  : 'Number of installments'
              }
              inputMode="numeric"
              value={count}
              onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))}
              error={errors.installmentCount}
              hint={
                product
                  ? `${product.minTenor} to ${product.maxTenor}, paid ${product.repaymentFrequency}`
                  : 'Choose a product first'
              }
              disabled={!product}
            />
            {bnpl ? (
              <>
                <TextInput
                  label="Item the company will buy"
                  value={itemDescription}
                  onChange={(e) => setItemDescription(e.target.value)}
                  error={errors.itemDescription}
                  placeholder="e.g. Samsung 43-inch television"
                />
                <TextInput
                  label="Supplier to be paid"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  error={errors.supplierName}
                  placeholder="Shop or vendor name"
                />
              </>
            ) : (
              <TextArea
                label="What is the loan for?"
                containerClassName="sm:col-span-2"
                rows={2}
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                error={errors.purpose}
              />
            )}
          </div>
        </Panel>

        <Panel
          title="Collateral"
          actions={
            <Button
              size="sm"
              icon={<Plus className="size-4" aria-hidden />}
              onClick={() =>
                setCollateral((c) => [
                  ...c,
                  { description: '', estimatedValue: null, documentRef: '' },
                ])
              }
            >
              Add item
            </Button>
          }
        >
          {collateral.length === 0 && (
            <p className="text-ink-2 text-sm">
              Optional. Record anything pledged against the loan.
            </p>
          )}
          <div className="flex flex-col gap-4">
            {collateral.map((c, i) => (
              <div key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_12rem_10rem_auto]">
                <TextInput
                  label="Item"
                  value={c.description}
                  onChange={(e) =>
                    setCollateral((all) =>
                      all.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)),
                    )
                  }
                  error={errors[`collateral.${i}.description`]}
                />
                <MoneyInput
                  label="Worth about"
                  value={c.estimatedValue}
                  onChange={(v) =>
                    setCollateral((all) =>
                      all.map((x, j) => (j === i ? { ...x, estimatedValue: v } : x)),
                    )
                  }
                  error={errors[`collateral.${i}.estimatedValue`]}
                />
                <TextInput
                  label="Document ref"
                  optional
                  value={c.documentRef}
                  onChange={(e) =>
                    setCollateral((all) =>
                      all.map((x, j) => (j === i ? { ...x, documentRef: e.target.value } : x)),
                    )
                  }
                />
                <Button
                  variant="ghost"
                  aria-label={`Remove item ${i + 1}`}
                  icon={<Trash2 className="size-4" aria-hidden />}
                  onClick={() => setCollateral((all) => all.filter((_, j) => j !== i))}
                />
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="flex flex-col gap-4 xl:sticky xl:top-20 xl:self-start">
        <Panel title="What the customer pays">
          {!quote ? (
            <p className="text-ink-2 text-sm">
              Choose a product, amount and number of installments to see the repayments.
            </p>
          ) : (
            <>
              <p className="text-ink-2 text-sm">Each installment</p>
              <Money value={quote.installment} className="text-2xl font-semibold" />
              <p className="text-ink-2 text-sm">
                {product?.repaymentFrequency},{' '}
                {tenorLabel(Number(count), product!.repaymentFrequency)} from the day it is paid out
              </p>
              <dl className="border-rule mt-4 grid grid-cols-[1fr_auto] gap-y-1.5 border-t pt-3 text-sm">
                <dt className="text-ink-2">{bnpl ? 'Item price' : 'Amount borrowed'}</dt>
                <dd className="text-right">
                  <Money value={principal!} />
                </dd>
                <dt className="text-ink-2">Interest</dt>
                <dd className="text-right">
                  <Money value={quote.interest} />
                </dd>
                <dt className="font-medium">Total to repay</dt>
                <dd className="text-right font-semibold">
                  <Money value={quote.totalRepayable} />
                </dd>
                <dt className="text-ink-2 mt-2">
                  Processing fee (
                  {describeFee(product!.processingFee, (k) =>
                    formatNaira(k, { trimZeroKobo: true }),
                  )}
                  )
                </dt>
                <dd className="mt-2 text-right">
                  <Money value={quote.fee} />
                </dd>
                {topUp && (
                  <>
                    <dt className="text-ink-2">Settles {topUp.loanNumber}</dt>
                    <dd className="text-right">
                      <Money value={quote.settle} />
                    </dd>
                  </>
                )}
                <dt className="font-medium">
                  {bnpl ? 'Company pays the supplier' : 'Customer receives'}
                </dt>
                <dd className={cn('text-right font-semibold', quote.payout <= 0 && 'text-brick')}>
                  <Money value={quote.payout} />
                </dd>
                <dt className="text-ink-2 mt-2">If paid out today, final installment</dt>
                <dd className="mt-2 text-right">{formatDate(quote.maturityDate)}</dd>
              </dl>
            </>
          )}
        </Panel>
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={blocked}
          loading={submit.isPending}
          loadingLabel="Sending…"
          onClick={() => {
            setFormError(null)
            if (validate()) submit.mutate()
          }}
        >
          Send for approval
        </Button>
        {blocked && <p className="text-brick text-sm">Fix the customer checks above first.</p>}
      </div>
    </div>
  )
}
