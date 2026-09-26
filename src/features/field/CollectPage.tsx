import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  CloudOff,
  MapPin,
  MessageSquareText,
  Search,
} from 'lucide-react'
import { MoneyInput } from '@/components/form/MoneyInput'
import { EmptyState, ErrorState, LoadingState } from '@/components/states'
import { Alert } from '@/components/ui/Alert'
import { Button, ButtonLink } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/Tabs'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { cn } from '@/lib/cn'
import { formatTime, todayIso } from '@/lib/dates'
import { amountSizeClass, formatNaira, kobo, type Kobo } from '@/lib/money'
import { formatPhone, maskPhone } from '@/lib/phone'
import type { Account, Customer, Loan, PaymentMethod } from '@/types'
import {
  useFieldData,
  usePortfolio,
  useTodayView,
  type DueView,
  type OutboxEntry,
} from './FieldData'
import { useGeolocation } from './useGeolocation'

// ── Customer picker ───────────────────────────────────────────────────────

export function CollectPickerPage() {
  useDocumentTitle('Collect')
  const portfolio = usePortfolio()
  const { view } = useTodayView()
  const [search, setSearch] = useState('')

  if (portfolio.isPending) return <LoadingState label="Loading your customers…" />
  if (portfolio.error || !portfolio.data)
    return <ErrorState error={portfolio.error} onRetry={() => void portfolio.refetch()} />

  const due = new Map(view?.items.map((i) => [i.customerId, i]))
  const q = search.trim().toLowerCase()
  const customers = portfolio.data.data.customers
    .filter((c) => c.status === 'active')
    .filter(
      (c) =>
        !q ||
        `${c.firstName} ${c.lastName} ${c.phone} ${c.customerNumber} ${c.area}`
          .toLowerCase()
          .includes(q),
    )
    .sort(
      (a, b) =>
        Number(due.has(b.id)) - Number(due.has(a.id)) || a.firstName.localeCompare(b.firstName),
    )

  return (
    <>
      <h1 className="text-xl font-semibold">Who is paying?</h1>
      <SearchField value={search} onChange={setSearch} />
      {customers.length === 0 ? (
        <EmptyState
          title="No customer matches"
          description="Check the spelling, or search by phone number. You can only collect from customers assigned to you."
        />
      ) : (
        <ul className="mt-2">
          {customers.map((c) => {
            const item = due.get(c.id)
            return (
              <li key={c.id} className="border-rule border-b">
                <Link
                  to={`/field/collect/${c.id}`}
                  className="active:bg-ink-tint flex min-h-16 items-center gap-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {c.firstName} {c.lastName}
                    </p>
                    <p className="text-ink-2 truncate text-sm">
                      {c.area} · {formatPhone(c.phone)}
                    </p>
                  </div>
                  {item && !item.done && <span className="text-sm font-semibold">Due today</span>}
                  {item?.done && (
                    <Check className="text-ledger size-5" aria-label="Collected today" />
                  )}
                  <ChevronRight className="text-ink-3 size-5" aria-hidden />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

export function SearchField({
  value,
  onChange,
  placeholder = 'Name, phone or area',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="relative mt-3 block">
      <span className="sr-only">Search your customers</span>
      <Search
        className="text-ink-3 pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2"
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="border-rule-strong text-field placeholder:text-ink-3 focus:border-ink focus:outline-ink h-14 w-full rounded border bg-white pr-4 pl-12 focus:outline-2 focus:outline-offset-0"
      />
    </label>
  )
}

// ── Collection flow ───────────────────────────────────────────────────────

interface Option {
  account: Account
  loan: Loan | undefined
  due: DueView | undefined
  kind: 'loan' | 'thrift'
  label: string
  /** Suggested amount: what is still due today. */
  suggested: Kobo | null
  blocked: string | null
}

type Step = 'account' | 'amount' | 'confirm' | 'done'

/**
 * Amount to prefill: what is still due today. When nothing is due but the loan
 * is behind, one installment towards the arrears (never more than the arrears).
 */
function suggestAmount(
  kind: 'loan' | 'thrift',
  due: DueView | undefined,
  loan: Loan | undefined,
): Kobo | null {
  if (due && due.remaining > 0) return due.remaining
  if (kind === 'loan' && loan && loan.status === 'active') {
    const arrears = due?.arrears ?? loan.arrears
    if (arrears > 0) return kobo(Math.min(loan.installmentAmount, arrears))
    if (!due) return loan.installmentAmount
  }
  return null
}

export function CollectPage() {
  const { customerId = '' } = useParams()
  const portfolio = usePortfolio()
  const { view } = useTodayView()

  if (portfolio.isPending) return <LoadingState label="Loading…" />
  if (portfolio.error || !portfolio.data)
    return <ErrorState error={portfolio.error} onRetry={() => void portfolio.refetch()} />
  const customer = portfolio.data.data.customers.find((c) => c.id === customerId)
  if (!customer) {
    return (
      <EmptyState
        title="This customer isn't on your list"
        description="They may have been moved to another officer. Check with your branch manager."
        action={<ButtonLink to="/field/collect">Choose another customer</ButtonLink>}
      />
    )
  }
  const todayItem = view?.items.find((i) => i.customerId === customer.id)
  const options: Option[] = portfolio.data.data.accounts
    .filter(
      (a) =>
        a.customerId === customer.id &&
        (a.type === 'thrift' || a.type === 'loan') &&
        a.status !== 'closed',
    )
    .map((account) => {
      const loan = portfolio.data.data.loans.find((l) => l.accountId === account.id)
      const due = todayItem?.dues.find((d) => d.accountId === account.id)
      const kind = account.type as 'loan' | 'thrift'
      return {
        account,
        loan,
        due,
        kind,
        label:
          kind === 'loan'
            ? `Loan repayment · ${account.productName ?? ''}`
            : `Thrift · ${account.productName ?? ''}`,
        suggested: suggestAmount(kind, due, loan),
        blocked:
          account.status !== 'active'
            ? `This account is ${account.status}. Don't collect; tell your branch manager.`
            : null,
      }
    })

  return <CollectFlow key={customer.id} customer={customer} options={options} />
}

function CollectFlow({ customer, options }: { customer: Customer; options: Option[] }) {
  const name = `${customer.firstName} ${customer.lastName}`
  useDocumentTitle(`Collect from ${name}`)
  const navigate = useNavigate()
  const { record, entries } = useFieldData()
  const geo = useGeolocation()
  const usable = options.filter((o) => !o.blocked)
  const [step, setStep] = useState<Step>(usable.length === 1 ? 'amount' : 'account')
  const [option, setOption] = useState<Option | null>(usable.length === 1 ? usable[0]! : null)
  const [amount, setAmount] = useState<Kobo | null>(
    usable.length === 1 ? usable[0]!.suggested || null : null,
  )
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [amountError, setAmountError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedKey, setSavedKey] = useState<string | null>(null)

  const earlierToday = useMemo(
    () =>
      entries.filter(
        (e) =>
          option &&
          e.accountId === option.account.id &&
          e.day === todayIso() &&
          e.status !== 'failed',
      ),
    [entries, option],
  )

  const choose = (o: Option) => {
    setOption(o)
    setAmount(o.suggested || null)
    setAmountError(null)
    setStep('amount')
  }

  const toConfirm = () => {
    if (!option) return
    if (!amount || amount <= 0) {
      setAmountError('Enter the amount the customer gave you.')
      return
    }
    if (option.loan && amount > option.loan.outstanding) {
      setAmountError(
        `That is more than the ${formatNaira(option.loan.outstanding)} left on the loan.`,
      )
      return
    }
    setAmountError(null)
    setStep('confirm')
  }

  const save = async () => {
    if (!option || !amount) return
    setSaving(true)
    try {
      const entry = await record({
        customerId: customer.id,
        customerName: name,
        accountId: option.account.id,
        accountNumber: option.account.accountNumber,
        kind: option.kind,
        productName: option.account.productName ?? '',
        amount,
        paymentMethod: method,
        location: geo.status === 'found' ? geo.point : null,
      })
      setSavedKey(entry.key)
      setStep('done')
    } finally {
      setSaving(false)
    }
  }

  const header = (
    <div className="mb-4">
      {step !== 'done' && (
        <button
          type="button"
          onClick={() =>
            step === 'confirm'
              ? setStep('amount')
              : step === 'amount' && usable.length > 1
                ? setStep('account')
                : navigate(-1)
          }
          className="text-ink-2 mb-2 -ml-1 inline-flex min-h-11 items-center gap-1.5 font-medium"
        >
          <ArrowLeft className="size-5" aria-hidden /> Back
        </button>
      )}
      <h1 className="text-xl font-semibold">{name}</h1>
      <p className="text-ink-2 text-sm">
        {customer.area} ·{' '}
        <a href={`tel:${customer.phone}`} className="underline">
          {formatPhone(customer.phone)}
        </a>
      </p>
    </div>
  )

  if (step === 'done' && savedKey) {
    return (
      <>
        {header}
        <Receipt entryKey={savedKey} />
      </>
    )
  }

  if (step === 'account') {
    return (
      <>
        {header}
        <h2 className="text-field font-semibold">What are they paying?</h2>
        {options.length === 0 && (
          <EmptyState
            title="No loan or thrift account"
            description="This customer has nothing to collect in the field. Savings deposits are taken at the counter."
          />
        )}
        <ul className="mt-2">
          {options.map((o) => (
            <li key={o.account.id} className="border-rule border-b">
              <button
                type="button"
                disabled={Boolean(o.blocked)}
                onClick={() => choose(o)}
                className="active:bg-ink-tint flex min-h-20 w-full items-center gap-3 py-3 text-left disabled:opacity-60"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{o.label}</p>
                  <p className="text-ink-2 font-mono text-sm">{o.account.accountNumber}</p>
                  {o.due && o.due.arrears > 0 && (
                    <p className="text-brick text-sm font-semibold">
                      {formatNaira(o.due.arrears)} in arrears
                    </p>
                  )}
                  {o.blocked && <p className="text-brick text-sm font-semibold">{o.blocked}</p>}
                  {o.due?.done && (
                    <p className="text-ledger text-sm font-semibold">Already collected today</p>
                  )}
                </div>
                {o.suggested !== null && o.suggested > 0 && (
                  <span className="tabular text-xl font-semibold">
                    {formatNaira(o.suggested, { trimZeroKobo: true })}
                  </span>
                )}
                <ChevronRight className="text-ink-3 size-5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </>
    )
  }

  if (!option) return null
  const withArrears =
    option.due && option.due.arrears > 0 ? kobo(option.due.remaining + option.due.arrears) : null

  if (step === 'amount') {
    return (
      <>
        {header}
        <p className="font-semibold">{option.label}</p>
        <p className="text-ink-2 mb-4 font-mono text-sm">{option.account.accountNumber}</p>
        <MoneyInput
          label="Amount received"
          variant="amount"
          value={amount}
          onChange={setAmount}
          error={amountError ?? undefined}
          autoFocus={!amount}
        />
        {(option.suggested || withArrears) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {option.suggested ? (
              <QuickAmount
                label="Due today"
                amount={option.suggested}
                onPick={setAmount}
                active={amount === option.suggested}
              />
            ) : null}
            {withArrears ? (
              <QuickAmount
                label="Due + arrears"
                amount={withArrears}
                onPick={setAmount}
                active={amount === withArrears}
              />
            ) : null}
          </div>
        )}
        <div className="mt-6">
          <p className="text-field mb-2 font-medium">How did they pay?</p>
          <SegmentedControl
            size="xl"
            label="Payment method"
            value={method}
            onChange={setMethod}
            options={[
              { value: 'cash', label: 'Cash' },
              { value: 'transfer', label: 'Transfer' },
            ]}
          />
          {method === 'transfer' && (
            <p className="text-ink-2 mt-2 text-sm">
              Only record a transfer once you've seen the credit alert.
            </p>
          )}
        </div>
        <div className="mt-8">
          <Button variant="ink" size="xl" onClick={toConfirm}>
            Continue
          </Button>
        </div>
      </>
    )
  }

  // Confirm
  return (
    <>
      {header}
      <section aria-label="Check before recording" className="border-ink border-y-2 py-4">
        <p className="text-ink-2 text-sm">
          {option.kind === 'loan' ? 'Loan repayment' : 'Thrift contribution'}
        </p>
        <p
          className={cn(
            amountSizeClass(formatNaira(amount!, { trimZeroKobo: true })),
            'tabular font-semibold',
          )}
        >
          {formatNaira(amount!, { trimZeroKobo: true })}
        </p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-base">
          <dt className="text-ink-2">Account</dt>
          <dd className="font-mono">{option.account.accountNumber}</dd>
          <dt className="text-ink-2">Paid by</dt>
          <dd>{method === 'cash' ? 'Cash' : 'Transfer'}</dd>
          <dt className="text-ink-2">Receipt to</dt>
          <dd>{maskPhone(customer.phone)} by SMS</dd>
        </dl>
      </section>
      <p
        className={cn(
          'mt-3 flex items-start gap-2 text-sm',
          geo.status === 'unavailable' ? 'text-ochre' : 'text-ink-2',
        )}
      >
        <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
        {geo.status === 'locating' && 'Getting your location…'}
        {geo.status === 'found' && `Location captured (±${geo.point.accuracyM ?? '?'} m)`}
        {geo.status === 'unavailable' && geo.reason}
      </p>
      {earlierToday.length > 0 && (
        <Alert tone="warning" className="mt-4" title="Already recorded today">
          You recorded{' '}
          {earlierToday
            .map(
              (e) =>
                `${formatNaira(e.amount, { trimZeroKobo: true })} at ${formatTime(e.collectedAt)}`,
            )
            .join(' and ')}{' '}
          for this account. Only continue if this is a new payment.
        </Alert>
      )}
      <div className="mt-6 flex flex-col gap-3">
        <Button variant="ink" size="xl" onClick={save} loading={saving} loadingLabel="Recording…">
          Record {formatNaira(amount!, { trimZeroKobo: true })}{' '}
          {option.kind === 'loan' ? 'repayment' : 'thrift'}
        </Button>
        <Button size="xl" onClick={() => setStep('amount')} disabled={saving}>
          Change amount
        </Button>
      </div>
    </>
  )
}

function QuickAmount({
  label,
  amount,
  onPick,
  active,
}: {
  label: string
  amount: Kobo
  onPick: (k: Kobo) => void
  active: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(amount)}
      aria-pressed={active}
      className={cn(
        'min-h-12 rounded border-2 px-4 text-left',
        active ? 'border-ink bg-ink text-white' : 'border-rule-strong bg-white',
      )}
    >
      <span className="block text-xs font-medium opacity-80">{label}</span>
      <span className="tabular font-semibold">{formatNaira(amount, { trimZeroKobo: true })}</span>
    </button>
  )
}

function Receipt({ entryKey }: { entryKey: string }) {
  const { entries, sync, syncing } = useFieldData()
  const entry: OutboxEntry | undefined = entries.find((e) => e.key === entryKey)
  if (!entry) return <LoadingState />
  const amount = formatNaira(entry.amount, { trimZeroKobo: true })

  return (
    <div role="status" aria-live="polite">
      {entry.status === 'synced' && (
        <section className="border-ledger bg-ledger-tint border-l-4 px-4 py-4">
          <p className="text-ledger-strong flex items-center gap-2 text-lg font-semibold">
            <Check className="size-6" aria-hidden /> {amount} recorded
          </p>
          <p className="mt-1 font-mono text-sm">{entry.reference}</p>
          <p className="mt-3 flex items-center gap-2">
            <MessageSquareText className="size-5 shrink-0" aria-hidden />
            {entry.smsStatus === 'sent'
              ? `SMS receipt sent to ${entry.phoneHint}`
              : 'The SMS receipt is queued and will be sent shortly.'}
          </p>
        </section>
      )}
      {(entry.status === 'pending' || entry.status === 'syncing') && (
        <section className="border-ochre bg-ochre-tint border-l-4 px-4 py-4">
          <p className="flex items-center gap-2 text-lg font-semibold">
            <CloudOff className="text-ochre size-6" aria-hidden /> {amount} saved on this phone
          </p>
          <p className="mt-2">
            It will upload by itself when you have network. The customer gets their SMS receipt
            then. Keep the cash safe as usual.
          </p>
          <Button
            className="mt-3"
            onClick={() => void sync()}
            loading={syncing}
            loadingLabel="Trying…"
          >
            Try to sync now
          </Button>
        </section>
      )}
      {entry.status === 'failed' && (
        <section className="border-brick bg-brick-tint border-l-4 px-4 py-4">
          <p className="text-brick-strong flex items-center gap-2 text-lg font-semibold">
            <AlertTriangle className="size-6" aria-hidden /> The office did not accept this
          </p>
          <p className="mt-2">{entry.error}</p>
          <p className="mt-2 text-sm">
            It's kept under End of day so you can sort it out with the accountant.
          </p>
        </section>
      )}
      <div className="mt-6 flex flex-col gap-3">
        <ButtonLink to="/field/today" variant="ink" size="xl">
          Next customer
        </ButtonLink>
        <ButtonLink to="/field/collect" size="xl">
          Collect from someone else
        </ButtonLink>
      </div>
    </div>
  )
}
