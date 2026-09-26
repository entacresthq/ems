import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { fetchAll } from '@/api/pagination'
import { transactionKeys, transactionsApi } from '@/api/transactions'
import { DataTable, type Column } from '@/components/data/DataTable'
import { FilterBar, FilterDate, FilterSelect, SearchBox } from '@/components/data/Filters'
import { Button } from '@/components/ui/Button'
import { Money } from '@/components/ui/display'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Can } from '@/features/auth/Can'
import { useBranchScope } from '@/features/organisation/BranchScope'
import { ExportButton } from '@/features/shared/ExportButton'
import { useOfficers } from '@/features/shared/lookups'
import { useListParams } from '@/hooks/useListParams'
import { formatDateTime } from '@/lib/dates'
import { toDecimal } from '@/lib/money'
import {
  TRANSACTION_TYPE_LABELS,
  type Transaction,
  type TransactionChannel,
  type TransactionListParams,
  type TransactionStatus,
  type TransactionType,
} from '@/types'
import { CounterPostingDialog } from './CounterPostingDialog'
import { signedAmount, TransactionDialog } from './TransactionDialog'

const FILTERS = [
  'type',
  'status',
  'channel',
  'officer',
  'customer',
  'account',
  'date_from',
  'date_to',
] as const

export function TransactionsPage() {
  const { branchId } = useBranchScope()
  const officers = useOfficers(branchId)
  const list = useListParams(FILTERS, { ordering: '-created_at' })
  const f = list.filters
  const [selected, setSelected] = useState<Transaction | null>(null)
  const [posting, setPosting] = useState(false)

  const params: TransactionListParams = {
    page: list.page,
    pageSize: list.pageSize,
    ordering: list.ordering,
    search: list.search || undefined,
    branch: branchId ?? undefined,
    type: f.type as TransactionType | undefined,
    status: f.status as TransactionStatus | undefined,
    channel: f.channel as TransactionChannel | undefined,
    officer: f.officer,
    customer: f.customer,
    account: f.account,
    dateFrom: f.date_from,
    dateTo: f.date_to,
  }
  const query = useQuery({
    queryKey: transactionKeys.list(params),
    queryFn: () => transactionsApi.list(params),
    placeholderData: keepPreviousData,
  })

  const columns: Column<Transaction>[] = [
    {
      id: 'date',
      header: 'Date and time',
      sortKey: 'created_at',
      cell: (t) => formatDateTime(t.createdAt),
    },
    {
      id: 'ref',
      header: 'Reference',
      sortKey: 'reference',
      cell: (t) => <span className="font-mono text-xs">{t.reference}</span>,
    },
    { id: 'customer', header: 'Customer', sortKey: 'customer_name', cell: (t) => t.customerName },
    {
      id: 'account',
      header: 'Account',
      cell: (t) => <span className="font-mono">{t.accountNumber}</span>,
    },
    { id: 'type', header: 'Type', sortKey: 'type', cell: (t) => TRANSACTION_TYPE_LABELS[t.type] },
    {
      id: 'by',
      header: 'Channel',
      cell: (t) =>
        t.channel === 'field' ? t.officerName : t.channel === 'counter' ? 'Counter' : 'System',
    },
    {
      id: 'method',
      header: 'Paid by',
      cell: (t) =>
        t.paymentMethod === 'cash' ? 'Cash' : t.paymentMethod === 'transfer' ? 'Transfer' : '—',
    },
    {
      id: 'amount',
      header: 'Amount',
      sortKey: 'amount',
      align: 'right',
      cell: (t) => <Money value={signedAmount(t)} signed className="font-medium" />,
    },
    { id: 'status', header: 'Status', cell: (t) => <StatusBadge status={t.status} /> },
  ]

  const scopedToRecord = f.customer || f.account

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Every posting in the branches you can see. Select a row for details or to request a reversal."
        actions={
          <Can permission="transactions.post">
            <Button
              variant="primary"
              icon={<Plus className="size-4" aria-hidden />}
              onClick={() => setPosting(true)}
            >
              Post transaction
            </Button>
          </Can>
        }
      />
      {scopedToRecord && (
        <p className="mb-3 flex items-center gap-3 text-sm">
          Showing one {f.customer ? 'customer' : 'account'} only.
          <button
            type="button"
            className="font-medium underline"
            onClick={() => {
              list.setFilter('customer', undefined)
              list.setFilter('account', undefined)
            }}
          >
            Show all
          </button>
        </p>
      )}
      <DataTable
        caption="Transactions"
        columns={columns}
        rows={query.data?.results}
        getRowId={(t) => t.id}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={setSelected}
        ordering={list.ordering}
        onOrderingChange={list.setOrdering}
        empty={
          list.hasFilters
            ? {
                title: 'No transactions match these filters',
                description: 'Widen the dates or clear a filter.',
                action: (
                  <Button size="sm" onClick={list.clearFilters}>
                    Clear filters
                  </Button>
                ),
              }
            : {
                title: 'No transactions yet',
                description: 'Field collections and counter postings appear here as they happen.',
              }
        }
        toolbar={
          <FilterBar
            actions={
              <ExportButton
                filename="transactions"
                fetchRows={() =>
                  fetchAll((page) => transactionsApi.list({ ...params, page, pageSize: 100 }))
                }
                columns={[
                  {
                    header: 'Date and time',
                    value: (t: Transaction) => formatDateTime(t.createdAt),
                  },
                  { header: 'Reference', value: (t) => t.reference },
                  { header: 'Customer', value: (t) => t.customerName },
                  { header: 'Account', value: (t) => t.accountNumber },
                  { header: 'Type', value: (t) => TRANSACTION_TYPE_LABELS[t.type] },
                  { header: 'Channel', value: (t) => t.channel },
                  { header: 'Officer', value: (t) => t.officerName },
                  { header: 'Paid by', value: (t) => t.paymentMethod },
                  {
                    header: 'Debit (NGN)',
                    value: (t) => (t.direction === 'debit' ? toDecimal(t.amount) : ''),
                  },
                  {
                    header: 'Credit (NGN)',
                    value: (t) => (t.direction === 'credit' ? toDecimal(t.amount) : ''),
                  },
                  { header: 'Status', value: (t) => t.status },
                ]}
              />
            }
          >
            <SearchBox
              label="Search"
              value={list.search}
              onChange={list.setSearch}
              placeholder="Reference, customer or account"
            />
            <FilterDate
              label="From"
              value={f.date_from ?? ''}
              max={f.date_to}
              onChange={(e) => list.setFilter('date_from', e.target.value)}
            />
            <FilterDate
              label="To"
              value={f.date_to ?? ''}
              min={f.date_from}
              onChange={(e) => list.setFilter('date_to', e.target.value)}
            />
            <FilterSelect
              label="Type"
              value={f.type ?? ''}
              onChange={(e) => list.setFilter('type', e.target.value)}
            >
              <option value="">All types</option>
              {Object.entries(TRANSACTION_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              label="Channel"
              value={f.channel ?? ''}
              onChange={(e) => list.setFilter('channel', e.target.value)}
            >
              <option value="">All channels</option>
              <option value="field">Field</option>
              <option value="counter">Counter</option>
              <option value="system">System</option>
            </FilterSelect>
            <FilterSelect
              label="Officer"
              value={f.officer ?? ''}
              onChange={(e) => list.setFilter('officer', e.target.value)}
            >
              <option value="">All officers</option>
              {officers.data?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              label="Status"
              value={f.status ?? ''}
              onChange={(e) => list.setFilter('status', e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="posted">Posted</option>
              <option value="pending_reversal">Reversal pending</option>
              <option value="reversed">Reversed</option>
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
      <TransactionDialog transaction={selected} onClose={() => setSelected(null)} />
      <CounterPostingDialog open={posting} onClose={() => setPosting(false)} />
    </>
  )
}
