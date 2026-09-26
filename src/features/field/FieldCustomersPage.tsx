import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronRight, Phone, UserPlus } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState } from '@/components/states'
import { Alert } from '@/components/ui/Alert'
import { ButtonLink } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { formatDate, formatTime } from '@/lib/dates'
import { formatNaira } from '@/lib/money'
import { formatPhone } from '@/lib/phone'
import { ACCOUNT_TYPE_LABELS } from '@/types'
import { SearchField } from './CollectPage'
import { useFieldData, usePortfolio } from './FieldData'

export function FieldCustomersPage() {
  useDocumentTitle('Customers')
  const portfolio = usePortfolio()
  const [search, setSearch] = useState('')
  if (portfolio.isPending) return <LoadingState label="Loading your customers…" />
  if (portfolio.error || !portfolio.data)
    return <ErrorState error={portfolio.error} onRetry={() => void portfolio.refetch()} />

  const q = search.trim().toLowerCase()
  const customers = portfolio.data.data.customers
    .filter(
      (c) =>
        !q ||
        `${c.firstName} ${c.lastName} ${c.phone} ${c.customerNumber} ${c.area}`
          .toLowerCase()
          .includes(q),
    )
    .sort((a, b) => a.firstName.localeCompare(b.firstName))

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">
          My customers ({portfolio.data.data.customers.length})
        </h1>
      </div>
      {portfolio.data.fromCache && (
        <p className="text-ochre mt-1 text-sm">
          Offline: saved on {formatDate(portfolio.data.savedAt)} at{' '}
          {formatTime(portfolio.data.savedAt)}.
        </p>
      )}
      <SearchField value={search} onChange={setSearch} placeholder="Name, phone, area or number" />
      <ButtonLink
        to="/field/customers/new"
        size="xl"
        className="mt-3"
        icon={<UserPlus className="size-5" aria-hidden />}
      >
        Register a new thrift customer
      </ButtonLink>
      {customers.length === 0 ? (
        <EmptyState
          title="No customer matches"
          description="Check the spelling or search by phone number."
        />
      ) : (
        <ul className="mt-3">
          {customers.map((c) => (
            <li key={c.id} className="border-rule border-b">
              <Link
                to={`/field/customers/${c.id}`}
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
                {c.status !== 'active' && <StatusBadge status={c.status} />}
                <ChevronRight className="text-ink-3 size-5" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

export function FieldCustomerDetailPage() {
  const { customerId = '' } = useParams()
  const portfolio = usePortfolio()
  const { entries } = useFieldData()
  if (portfolio.isPending) return <LoadingState />
  if (portfolio.error || !portfolio.data)
    return <ErrorState error={portfolio.error} onRetry={() => void portfolio.refetch()} />
  const { customers, accounts, loans } = portfolio.data.data
  const c = customers.find((x) => x.id === customerId)
  if (!c)
    return (
      <EmptyState
        title="This customer isn't on your list"
        action={<ButtonLink to="/field/customers">Back to customers</ButtonLink>}
      />
    )
  const mine = accounts.filter((a) => a.customerId === c.id)
  const recent = entries.filter((e) => e.customerId === c.id).slice(0, 5)

  return (
    <>
      <h1 className="text-xl font-semibold">
        {c.firstName} {c.lastName}
      </h1>
      <p className="text-ink-2 text-sm">
        <span className="font-mono">{c.customerNumber}</span> · {c.area}
      </p>
      <p className="mt-1 text-sm">{c.address}</p>
      <a
        href={`tel:${c.phone}`}
        className="border-ink mt-3 inline-flex min-h-12 items-center gap-2 rounded border-2 px-4 font-semibold"
      >
        <Phone className="size-5" aria-hidden /> Call {formatPhone(c.phone)}
      </a>
      {c.status === 'pending_approval' && (
        <Alert tone="warning" className="mt-4">
          Waiting for the branch to approve this customer. You can collect once they are approved.
        </Alert>
      )}

      <h2 className="border-ink mt-6 border-b-2 pb-2 text-sm font-semibold">Accounts</h2>
      {mine.length === 0 && <p className="text-ink-2 py-3">No accounts yet.</p>}
      <ul>
        {mine.map((a) => {
          const loan = loans.find((l) => l.accountId === a.id)
          return (
            <li key={a.id} className="border-rule border-b py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    {ACCOUNT_TYPE_LABELS[a.type]} {a.productName && `· ${a.productName}`}
                  </p>
                  <p className="text-ink-2 font-mono text-sm">{a.accountNumber}</p>
                </div>
                <div className="text-right">
                  <p className="text-ink-2 text-xs">
                    {a.type === 'loan' ? 'Left to pay' : 'Balance'}
                  </p>
                  <p className="tabular text-xl font-semibold">
                    {formatNaira(a.balance, { trimZeroKobo: true })}
                  </p>
                </div>
              </div>
              {a.status !== 'active' && <StatusBadge status={a.status} className="mt-1" />}
              {loan && loan.status === 'active' && (
                <dl className="mt-2 grid grid-cols-2 gap-y-1 text-sm">
                  <dt className="text-ink-2">Installment</dt>
                  <dd className="tabular text-right">
                    {formatNaira(loan.installmentAmount, { trimZeroKobo: true })} {loan.frequency}
                  </dd>
                  <dt className="text-ink-2">Arrears</dt>
                  <dd
                    className={
                      loan.arrears > 0
                        ? 'text-brick tabular text-right font-semibold'
                        : 'tabular text-right'
                    }
                  >
                    {loan.arrears > 0
                      ? `${formatNaira(loan.arrears, { trimZeroKobo: true })} · ${loan.daysInArrears} days`
                      : 'None'}
                  </dd>
                  <dt className="text-ink-2">Final installment</dt>
                  <dd className="text-right">
                    {loan.maturityDate ? formatDate(loan.maturityDate) : '—'}
                  </dd>
                </dl>
              )}
            </li>
          )
        })}
      </ul>

      {recent.length > 0 && (
        <>
          <h2 className="border-ink mt-6 border-b-2 pb-2 text-sm font-semibold">
            Recorded on this phone
          </h2>
          <ul>
            {recent.map((e) => (
              <li key={e.key} className="border-rule flex justify-between border-b py-2 text-sm">
                <span>
                  {formatDate(e.collectedAt)} {formatTime(e.collectedAt)} ·{' '}
                  {e.kind === 'loan' ? 'Loan' : 'Thrift'}
                </span>
                <span className="tabular font-semibold">
                  {formatNaira(e.amount, { trimZeroKobo: true })}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {c.status === 'active' && (
        <ButtonLink to={`/field/collect/${c.id}`} variant="ink" size="xl" className="mt-6">
          Collect from {c.firstName}
        </ButtonLink>
      )}
    </>
  )
}
