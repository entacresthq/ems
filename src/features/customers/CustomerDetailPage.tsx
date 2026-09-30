import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Pencil, Phone, Plus, UserRoundCog } from 'lucide-react'
import { accountKeys, accountsApi } from '@/api/accounts'
import { loanKeys, loansApi } from '@/api/loans'
import { customerKeys, customersApi } from '@/api/customers'
import { applyServerErrors } from '@/api/forms'
import { transactionKeys, transactionsApi } from '@/api/transactions'
import { DataTable, type Column } from '@/components/data/DataTable'
import { Select } from '@/components/form/inputs'
import { ErrorState, LoadingState } from '@/components/states'
import { Alert } from '@/components/ui/Alert'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { BackLink, DescriptionList, Initials, Money, Panel } from '@/components/ui/display'
import { useToast } from '@/components/ui/Toast'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { PendingApprovalBanner } from '@/features/approvals/ApprovalControls'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { Can } from '@/features/auth/Can'
import { OpenAccountDialog } from '@/features/accounts/OpenAccountDialog'
import { useOfficers } from '@/features/shared/lookups'
import { formatDate, formatDateTime } from '@/lib/dates'
import { maskBvn } from '@/lib/bvn'
import { hasPermission } from '@/lib/permissions'
import { formatPhone } from '@/lib/phone'
import {
  ACCOUNT_TYPE_LABELS,
  TRANSACTION_TYPE_LABELS,
  type Account,
  type Customer,
  type Loan,
  type Transaction,
} from '@/types'

export function CustomerDetailPage() {
  const { id = '' } = useParams()
  const query = useQuery({ queryKey: customerKeys.detail(id), queryFn: () => customersApi.get(id) })
  if (query.isPending) return <LoadingState label="Loading customer…" />
  if (query.isError)
    return (
      <ErrorState
        error={query.error}
        onRetry={() => void query.refetch()}
        title="Couldn't load this customer"
      />
    )
  return <CustomerProfile customer={query.data} />
}

function CustomerProfile({ customer: c }: { customer: Customer }) {
  const user = useCurrentUser()
  const name = `${c.firstName} ${c.otherNames ? c.otherNames + ' ' : ''}${c.lastName}`
  useDocumentTitle(name)
  const [openAccount, setOpenAccount] = useState(false)
  const [reassign, setReassign] = useState(false)

  return (
    <>
      <BackLink to="/customers">Customers</BackLink>
      <PendingApprovalBanner params={{ customer: c.id }} />
      <header className="border-rule mb-6 flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <Initials name={name} src={c.photoUrl} size="lg" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{name}</h1>
              <StatusBadge status={c.status} />
            </div>
            <p className="text-ink-2 mt-1 text-sm">
              <span className="font-mono">{c.customerNumber}</span> · {c.branchName} · {c.area}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-sm">
              <Phone className="text-ink-2 size-3.5" aria-hidden />
              <a href={`tel:${c.phone}`} className="underline-offset-2 hover:underline">
                {formatPhone(c.phone)}
              </a>
              <span className="text-ink-2">· Officer: {c.officerName}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Can permission="customers.reassign">
            <Button
              icon={<UserRoundCog className="size-4" aria-hidden />}
              onClick={() => setReassign(true)}
            >
              Reassign officer
            </Button>
          </Can>
          <Can permission="customers.edit">
            <ButtonLink
              to={`/customers/${c.id}/edit`}
              icon={<Pencil className="size-4" aria-hidden />}
            >
              Edit details
            </ButtonLink>
          </Can>
          {c.status === 'active' && hasPermission(user, 'loans.apply') && (
            <ButtonLink to={`/loans/new?customer=${c.id}`}>Apply for a loan</ButtonLink>
          )}
          {c.status === 'active' && hasPermission(user, 'accounts.open') && (
            <Button
              variant="primary"
              icon={<Plus className="size-4" aria-hidden />}
              onClick={() => setOpenAccount(true)}
            >
              Open account
            </Button>
          )}
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <CustomerAccounts customer={c} />
          <RecentTransactions customerId={c.id} />
        </div>
        <div className="flex flex-col gap-6">
          <Panel title="Details">
            <DescriptionList
              columns={1}
              items={[
                { label: 'Gender', value: c.gender === 'female' ? 'Female' : 'Male' },
                { label: 'Date of birth', value: c.dateOfBirth ? formatDate(c.dateOfBirth) : null },
                { label: 'Occupation', value: c.occupation },
                { label: 'Address', value: c.address },
                { label: 'Other phone', value: c.altPhone ? formatPhone(c.altPhone) : null },
                { label: 'Email', value: c.email },
                {
                  label: 'BVN',
                  value: c.bvn ? (
                    <span className="font-mono">{maskBvn(c.bvn)}</span>
                  ) : (
                    'Not provided'
                  ),
                },
                { label: 'Customer since', value: formatDate(c.createdAt) },
              ]}
            />
          </Panel>
          <Panel title="Next of kin">
            {c.nextOfKin ? (
              <DescriptionList
                columns={1}
                items={[
                  { label: 'Name', value: `${c.nextOfKin.fullName} (${c.nextOfKin.relationship})` },
                  { label: 'Phone', value: formatPhone(c.nextOfKin.phone) },
                  { label: 'Address', value: c.nextOfKin.address },
                ]}
              />
            ) : (
              <p className="text-ink-2 text-sm">
                Not recorded. Add a next of kin before this customer takes a loan.
              </p>
            )}
          </Panel>
          <Panel title={`Guarantors (${c.guarantors.length})`}>
            {c.guarantors.length === 0 ? (
              <p className="text-ink-2 text-sm">None recorded.</p>
            ) : (
              <ul className="divide-rule flex flex-col divide-y">
                {c.guarantors.map((g) => (
                  <li key={g.id} className="flex gap-3 py-3 text-sm first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{g.fullName}</p>
                      <p className="text-ink-2">
                        {formatPhone(g.phone)}
                        {g.relationship && ` · ${g.relationship}`}
                        {g.occupation && ` · ${g.occupation}`}
                      </p>
                      <p className="text-ink-2">{g.address}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {g.photoUrl ? (
                        <img
                          src={g.photoUrl}
                          alt={`Photo of guarantor ${g.fullName}`}
                          className="border-rule h-20 w-16 rounded border object-cover"
                        />
                      ) : (
                        <span className="text-ink-2 border-rule flex h-20 w-16 items-center justify-center rounded border border-dashed p-1 text-center text-xs">
                          No photo
                        </span>
                      )}
                      {g.signatureUrl ? (
                        <img
                          src={g.signatureUrl}
                          alt={`Signature of guarantor ${g.fullName}`}
                          className="border-rule h-20 w-32 rounded border bg-white object-contain"
                        />
                      ) : (
                        <span className="text-ink-2 border-rule flex h-20 w-32 items-center justify-center rounded border border-dashed p-1 text-center text-xs">
                          No signature
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Photo and signature">
            <div className="flex flex-wrap gap-4">
              {c.photoUrl ? (
                <img
                  src={c.photoUrl}
                  alt={`Photo of ${name}`}
                  className="border-rule h-32 w-28 rounded border object-cover"
                />
              ) : (
                <p className="text-ink-2 text-sm">No photo.</p>
              )}
              {c.signatureUrl ? (
                <img
                  src={c.signatureUrl}
                  alt={`Signature of ${name}`}
                  className="border-rule h-20 w-44 rounded border bg-white object-contain"
                />
              ) : (
                <p className="text-ink-2 text-sm">No signature.</p>
              )}
            </div>
          </Panel>
        </div>
      </div>

      <OpenAccountDialog open={openAccount} onClose={() => setOpenAccount(false)} customer={c} />
      <ReassignDialog open={reassign} onClose={() => setReassign(false)} customer={c} />
    </>
  )
}

function CustomerAccounts({ customer }: { customer: Customer }) {
  const navigate = useNavigate()
  const accounts = useQuery({
    queryKey: accountKeys.list({ customer: customer.id, pageSize: 100 }),
    queryFn: () => accountsApi.list({ customer: customer.id, pageSize: 100 }),
  })
  const loans = useQuery({
    queryKey: loanKeys.list({ customer: customer.id }),
    queryFn: () => loansApi.list({ customer: customer.id }),
  })
  const loanFor = (a: Account): Loan | undefined =>
    loans.data?.results.find((l) => l.accountId === a.id)

  const columns: Column<Account>[] = [
    {
      id: 'number',
      header: 'Account',
      cell: (a) => (
        <Link
          to={`/accounts/${a.id}`}
          className="font-mono font-medium hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {a.accountNumber}
        </Link>
      ),
    },
    { id: 'type', header: 'Type', cell: (a) => ACCOUNT_TYPE_LABELS[a.type] },
    { id: 'product', header: 'Plan or product', cell: (a) => a.productName ?? '—' },
    {
      id: 'arrears',
      header: 'Arrears',
      align: 'right',
      cell: (a) => {
        const loan = loanFor(a)
        return loan && loan.arrears > 0 ? (
          <Money value={loan.arrears} className="text-brick font-medium" />
        ) : (
          '—'
        )
      },
    },
    {
      id: 'balance',
      header: 'Balance or outstanding',
      align: 'right',
      cell: (a) => <Money value={a.balance} className="font-medium" />,
    },
    { id: 'status', header: 'Status', cell: (a) => <StatusBadge status={a.status} /> },
  ]

  return (
    <Panel title="Accounts" flush>
      <div className="[&>div]:rounded-none [&>div]:border-0">
        <DataTable
          caption="Accounts"
          columns={columns}
          rows={accounts.data?.results}
          getRowId={(a) => a.id}
          isLoading={accounts.isPending}
          error={accounts.error}
          onRetry={() => void accounts.refetch()}
          onRowClick={(a) => navigate(`/accounts/${a.id}`)}
          maxHeight="none"
          empty={{
            title: 'No accounts yet',
            description:
              customer.status === 'active'
                ? 'Use “Open account” to start a savings, target savings or thrift account.'
                : 'Accounts can be opened once the customer is approved.',
          }}
        />
      </div>
    </Panel>
  )
}

function RecentTransactions({ customerId }: { customerId: string }) {
  const params = { customer: customerId, pageSize: 10, ordering: '-created_at' }
  const query = useQuery({
    queryKey: transactionKeys.list(params),
    queryFn: () => transactionsApi.list(params),
  })
  const columns: Column<Transaction>[] = [
    { id: 'date', header: 'Date', cell: (t) => formatDateTime(t.createdAt) },
    { id: 'type', header: 'Type', cell: (t) => TRANSACTION_TYPE_LABELS[t.type] },
    {
      id: 'account',
      header: 'Account',
      cell: (t) => <span className="font-mono">{t.accountNumber}</span>,
    },
    {
      id: 'by',
      header: 'By',
      cell: (t) => t.officerName ?? (t.channel === 'counter' ? 'Counter' : 'System'),
    },
    {
      id: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (t) => (
        <Money value={t.direction === 'debit' ? (-t.amount as typeof t.amount) : t.amount} signed />
      ),
    },
    {
      id: 'status',
      header: <span className="sr-only">Status</span>,
      cell: (t) => (t.status === 'posted' ? '' : <StatusBadge status={t.status} />),
    },
  ]
  return (
    <Panel
      title="Recent transactions"
      flush
      actions={
        <Link
          to={`/transactions?customer=${customerId}`}
          className="text-sm font-medium underline underline-offset-2"
        >
          See all
        </Link>
      }
    >
      <div className="[&>div]:rounded-none [&>div]:border-0">
        <DataTable
          caption="Recent transactions"
          columns={columns}
          rows={query.data?.results}
          getRowId={(t) => t.id}
          isLoading={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
          maxHeight="none"
          empty={{
            title: 'No transactions yet',
            description: 'Collections and counter postings will appear here.',
          }}
        />
      </div>
    </Panel>
  )
}

function ReassignDialog({
  open,
  onClose,
  customer,
}: {
  open: boolean
  onClose: () => void
  customer: Customer
}) {
  const officers = useOfficers(customer.branchId, open)
  const [officerId, setOfficerId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()
  const toast = useToast()

  const submit = async () => {
    if (!officerId) {
      setError('Choose the officer who will take over.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const updated = await customersApi.reassign(customer.id, officerId)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: customerKeys.all }),
        queryClient.invalidateQueries({ queryKey: accountKeys.all }),
      ])
      toast({
        title: 'Officer changed',
        description: `${updated.officerName} now collects from ${customer.firstName} ${customer.lastName}.`,
      })
      setOfficerId('')
      onClose()
    } catch (e) {
      setError(applyServerErrors(e, () => undefined, []))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      size="sm"
      title="Reassign officer"
      description={`${customer.firstName} ${customer.lastName} is with ${customer.officerName}. All their accounts move to the new officer from tomorrow's list.`}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            Reassign customer
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alert tone="danger">{error}</Alert>}
        <Select
          label="New officer"
          value={officerId}
          onChange={(e) => setOfficerId(e.target.value)}
        >
          <option value="">Choose…</option>
          {officers.data
            ?.filter((o) => o.status === 'active' && o.id !== customer.officerId)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.branchId !== customer.branchId ? ` (${o.branchName})` : ''}
              </option>
            ))}
        </Select>
      </div>
    </Dialog>
  )
}
