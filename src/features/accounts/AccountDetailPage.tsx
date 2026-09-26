import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { accountKeys, accountsApi } from '@/api/accounts'
import { loanKeys, loansApi } from '@/api/loans'
import { fetchAll } from '@/api/pagination'
import { transactionKeys, transactionsApi } from '@/api/transactions'
import { DataTable, type Column } from '@/components/data/DataTable'
import { FilterBar, FilterDate } from '@/components/data/Filters'
import { ErrorState, LoadingState } from '@/components/states'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { BackLink, DescriptionList, Money, Panel } from '@/components/ui/display'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useToast } from '@/components/ui/Toast'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { PendingApprovalBanner } from '@/features/approvals/ApprovalControls'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { ExportButton } from '@/features/shared/ExportButton'
import { CounterPostingDialog } from '@/features/transactions/CounterPostingDialog'
import { signedAmount, TransactionDialog } from '@/features/transactions/TransactionDialog'
import { formatDate, formatDateTime } from '@/lib/dates'
import { toDecimal } from '@/lib/money'
import { hasPermission } from '@/lib/permissions'
import {
  ACCOUNT_TYPE_LABELS,
  TRANSACTION_TYPE_LABELS,
  type Account,
  type Transaction,
} from '@/types'

type Action = 'freeze' | 'unfreeze' | 'reactivate' | 'close' | null

export function AccountDetailPage() {
  const { id = '' } = useParams()
  const query = useQuery({ queryKey: accountKeys.detail(id), queryFn: () => accountsApi.get(id) })
  if (query.isPending) return <LoadingState label="Loading account…" />
  if (query.isError)
    return (
      <ErrorState
        error={query.error}
        onRetry={() => void query.refetch()}
        title="Couldn't load this account"
      />
    )
  return <AccountView account={query.data} />
}

function AccountView({ account: a }: { account: Account }) {
  useDocumentTitle(`Account ${a.accountNumber}`)
  const user = useCurrentUser()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [action, setAction] = useState<Action>(null)
  const [posting, setPosting] = useState(false)
  const loan = useQuery({
    queryKey: loanKeys.list({ account: a.id }),
    queryFn: () => loansApi.list({ account: a.id }),
    select: (p) => p.results[0],
    enabled: a.type === 'loan',
  })

  const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(user, p)
  const refresh = () =>
    Promise.all(
      ['accounts', 'approvals'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })),
    )

  const actions = {
    freeze: {
      title: 'Freeze this account?',
      confirm: 'Freeze account',
      tone: 'danger' as const,
      reason: {
        label: 'Why are you freezing it?',
        hint: 'For example, a court order or suspected fraud.',
      },
      body: 'No collections, deposits or withdrawals can be posted until it is unfrozen. The officer will see it as frozen in the field app.',
      run: async (reason: string) => {
        await accountsApi.freeze(a.id, reason)
        toast({ title: 'Account frozen', description: a.accountNumber })
      },
    },
    unfreeze: {
      title: 'Unfreeze this account?',
      confirm: 'Unfreeze account',
      tone: 'primary' as const,
      reason: undefined,
      body: 'The account can take transactions again straight away.',
      run: async () => {
        await accountsApi.unfreeze(a.id)
        toast({ title: 'Account unfrozen', description: a.accountNumber })
      },
    },
    reactivate: {
      title: 'Reactivate this dormant account?',
      confirm: 'Reactivate account',
      tone: 'primary' as const,
      reason: undefined,
      body: 'Confirm the customer came in person with ID before reactivating.',
      run: async () => {
        await accountsApi.reactivate(a.id)
        toast({ title: 'Account reactivated', description: a.accountNumber })
      },
    },
    close: {
      title: 'Request closure?',
      confirm: 'Send for approval',
      tone: 'danger' as const,
      reason: {
        label: 'Why should it be closed?',
        hint: 'A branch manager reads this before approving.',
      },
      body: 'The balance must be ₦0.00. The account stays open until a manager approves.',
      run: async (reason: string) => {
        await accountsApi.requestClosure(a.id, reason)
        toast({
          title: 'Closure requested',
          description: 'A branch manager will review it in Approvals.',
        })
      },
    },
  }
  const current = action ? actions[action] : null

  return (
    <>
      <BackLink to={`/customers/${a.customerId}`}>{a.customerName}</BackLink>
      <PendingApprovalBanner params={{ account: a.id }} />
      <header className="border-rule mb-6 flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-ink-2 text-sm">
            {ACCOUNT_TYPE_LABELS[a.type]} account{a.productName && ` · ${a.productName}`}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-xl font-semibold">{a.accountNumber}</h1>
            <StatusBadge status={a.status} />
          </div>
          <p className="mt-1 text-sm">
            <Link
              to={`/customers/${a.customerId}`}
              className="font-medium underline underline-offset-2"
            >
              {a.customerName}
            </Link>
            <span className="text-ink-2"> · opened {formatDate(a.openedAt)}</span>
          </p>
        </div>
        <div className="flex flex-col gap-3 lg:items-end">
          <div className="lg:text-right">
            <p className="text-ink-2 text-sm">{a.type === 'loan' ? 'Outstanding' : 'Balance'}</p>
            <Money value={a.balance} className="text-2xl font-semibold" />
          </div>
          <div className="flex flex-wrap gap-2">
            {a.status === 'active' && can('accounts.freeze') && (
              <Button onClick={() => setAction('freeze')}>Freeze</Button>
            )}
            {a.status === 'frozen' && can('accounts.freeze') && (
              <Button onClick={() => setAction('unfreeze')}>Unfreeze</Button>
            )}
            {a.status === 'dormant' && can('accounts.freeze') && (
              <Button onClick={() => setAction('reactivate')}>Reactivate</Button>
            )}
            {a.status !== 'closed' && a.type !== 'loan' && can('accounts.request_close') && (
              <Button onClick={() => setAction('close')}>Request closure</Button>
            )}
            {a.status === 'active' && can('transactions.post') && (
              <Button variant="primary" onClick={() => setPosting(true)}>
                Post transaction
              </Button>
            )}
          </div>
        </div>
      </header>

      {a.type === 'loan' && loan.data && (
        <Panel title="Loan summary" className="mb-6">
          <DescriptionList
            columns={3}
            items={[
              {
                label: 'Loan number',
                value: (
                  <Link
                    to={`/loans/${loan.data.id}`}
                    className="font-mono underline underline-offset-2"
                  >
                    {loan.data.loanNumber}
                  </Link>
                ),
              },
              { label: 'Principal', value: <Money value={loan.data.principal} /> },
              { label: 'Total to repay', value: <Money value={loan.data.totalRepayable} /> },
              { label: 'Repaid so far', value: <Money value={loan.data.amountPaid} /> },
              {
                label: 'Installment',
                value: (
                  <>
                    <Money value={loan.data.installmentAmount} /> {loan.data.frequency}
                  </>
                ),
              },
              {
                label: 'Arrears',
                value:
                  loan.data.arrears > 0 ? (
                    <span className="text-brick font-medium">
                      <Money value={loan.data.arrears} /> · {loan.data.daysInArrears} days late
                    </span>
                  ) : (
                    'None'
                  ),
              },
              { label: 'Penalty accrued', value: <Money value={loan.data.penaltyAccrued} /> },
              {
                label: 'Disbursed',
                value: loan.data.disbursedAt ? formatDate(loan.data.disbursedAt) : null,
              },
              {
                label: 'Final installment',
                value: loan.data.maturityDate ? formatDate(loan.data.maturityDate) : null,
              },
            ]}
          />
        </Panel>
      )}

      <Statement account={a} />

      {current && (
        <ConfirmDialog
          open
          onClose={() => setAction(null)}
          title={current.title}
          confirmLabel={current.confirm}
          tone={current.tone}
          reason={current.reason}
          onConfirm={async (reason) => {
            await current.run(reason)
            await refresh()
          }}
        >
          <p>{current.body}</p>
        </ConfirmDialog>
      )}
      <CounterPostingDialog open={posting} onClose={() => setPosting(false)} account={a} />
    </>
  )
}

function Statement({ account }: { account: Account }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Transaction | null>(null)
  const params = {
    account: account.id,
    dateFrom: from || undefined,
    dateTo: to || undefined,
    page,
    pageSize: 25,
    ordering: '-created_at',
  }
  const query = useQuery({
    queryKey: transactionKeys.list(params),
    queryFn: () => transactionsApi.list(params),
    placeholderData: keepPreviousData,
  })

  const columns: Column<Transaction>[] = [
    { id: 'date', header: 'Date', cell: (t) => formatDateTime(t.createdAt) },
    {
      id: 'ref',
      header: 'Reference',
      cell: (t) => <span className="font-mono text-xs">{t.reference}</span>,
    },
    {
      id: 'type',
      header: 'Description',
      cell: (t) => TRANSACTION_TYPE_LABELS[t.type] + (t.officerName ? ` · ${t.officerName}` : ''),
    },
    {
      id: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (t) => <Money value={signedAmount(t)} signed />,
    },
    {
      id: 'balance',
      header: 'Balance',
      align: 'right',
      cell: (t) => <Money value={t.balanceAfter} />,
    },
    {
      id: 'status',
      header: '',
      cell: (t) => (t.status === 'posted' ? null : <StatusBadge status={t.status} />),
    },
  ]

  return (
    <>
      <DataTable
        caption={`Statement for ${account.accountNumber}`}
        columns={columns}
        rows={query.data?.results}
        getRowId={(t) => t.id}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={setSelected}
        maxHeight="calc(100dvh - 12rem)"
        empty={{
          title: 'No transactions in this period',
          description:
            from || to ? 'Widen the date range.' : 'Nothing has been posted to this account yet.',
        }}
        toolbar={
          <FilterBar
            actions={
              <ExportButton
                label="Export statement"
                filename={`statement-${account.accountNumber}`}
                fetchRows={() =>
                  fetchAll((p) => transactionsApi.list({ ...params, page: p, pageSize: 100 }))
                }
                columns={[
                  { header: 'Date', value: (t: Transaction) => formatDateTime(t.createdAt) },
                  { header: 'Reference', value: (t) => t.reference },
                  { header: 'Description', value: (t) => TRANSACTION_TYPE_LABELS[t.type] },
                  {
                    header: 'Debit (NGN)',
                    value: (t) => (t.direction === 'debit' ? toDecimal(t.amount) : ''),
                  },
                  {
                    header: 'Credit (NGN)',
                    value: (t) => (t.direction === 'credit' ? toDecimal(t.amount) : ''),
                  },
                  { header: 'Balance (NGN)', value: (t) => toDecimal(t.balanceAfter) },
                  { header: 'Status', value: (t) => t.status },
                ]}
              />
            }
          >
            <p className="self-center text-sm font-semibold">Statement</p>
            <FilterDate
              label="From"
              value={from}
              max={to || undefined}
              onChange={(e) => {
                setFrom(e.target.value)
                setPage(1)
              }}
            />
            <FilterDate
              label="To"
              value={to}
              min={from || undefined}
              onChange={(e) => {
                setTo(e.target.value)
                setPage(1)
              }}
            />
          </FilterBar>
        }
        pagination={
          query.data && { page, pageSize: 25, count: query.data.count, onPageChange: setPage }
        }
      />
      <TransactionDialog transaction={selected} onClose={() => setSelected(null)} />
    </>
  )
}
