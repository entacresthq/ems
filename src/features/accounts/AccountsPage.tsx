import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { accountKeys, accountsApi } from '@/api/accounts'
import { fetchAll } from '@/api/pagination'
import { DataTable, type Column } from '@/components/data/DataTable'
import { FilterBar, FilterSelect, SearchBox } from '@/components/data/Filters'
import { Button } from '@/components/ui/Button'
import { Money } from '@/components/ui/display'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useBranchScope } from '@/features/organisation/BranchScope'
import { ExportButton } from '@/features/shared/ExportButton'
import { useOfficers } from '@/features/shared/lookups'
import { useListParams } from '@/hooks/useListParams'
import { formatDate } from '@/lib/dates'
import { toDecimal } from '@/lib/money'
import {
  ACCOUNT_TYPE_LABELS,
  type Account,
  type AccountListParams,
  type AccountStatus,
  type AccountType,
} from '@/types'

export function AccountsPage() {
  const navigate = useNavigate()
  const { branchId } = useBranchScope()
  const officers = useOfficers(branchId)
  const list = useListParams(['type', 'status', 'officer'] as const, { ordering: 'account_number' })
  const params: AccountListParams = {
    page: list.page,
    pageSize: list.pageSize,
    ordering: list.ordering,
    search: list.search || undefined,
    branch: branchId ?? undefined,
    type: list.filters.type as AccountType | undefined,
    status: list.filters.status as AccountStatus | undefined,
    officer: list.filters.officer,
  }
  const query = useQuery({
    queryKey: accountKeys.list(params),
    queryFn: () => accountsApi.list(params),
    placeholderData: keepPreviousData,
  })

  const columns: Column<Account>[] = [
    {
      id: 'number',
      header: 'Account',
      sortKey: 'account_number',
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
    {
      id: 'customer',
      header: 'Customer',
      sortKey: 'customer_name',
      cell: (a) => (
        <Link
          to={`/customers/${a.customerId}`}
          className="hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {a.customerName}
        </Link>
      ),
    },
    { id: 'type', header: 'Type', sortKey: 'type', cell: (a) => ACCOUNT_TYPE_LABELS[a.type] },
    { id: 'product', header: 'Plan or product', cell: (a) => a.productName ?? '—' },
    {
      id: 'balance',
      header: 'Balance',
      sortKey: 'balance',
      align: 'right',
      cell: (a) => <Money value={a.balance} className="font-medium" />,
    },
    {
      id: 'status',
      header: 'Status',
      sortKey: 'status',
      cell: (a) => <StatusBadge status={a.status} />,
    },
    {
      id: 'last',
      header: 'Last activity',
      sortKey: 'last_transaction_at',
      align: 'right',
      cell: (a) => (a.lastTransactionAt ? formatDate(a.lastTransactionAt) : '—'),
    },
  ]

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Savings, target savings, thrift and loan accounts. For loans, the balance is what is still owed."
      />
      <DataTable
        caption="Accounts"
        columns={columns}
        rows={query.data?.results}
        getRowId={(a) => a.id}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={(a) => navigate(`/accounts/${a.id}`)}
        ordering={list.ordering}
        onOrderingChange={list.setOrdering}
        empty={
          list.hasFilters
            ? {
                title: 'No accounts match these filters',
                description: 'Clear a filter or search by a different number or name.',
                action: (
                  <Button size="sm" onClick={list.clearFilters}>
                    Clear filters
                  </Button>
                ),
              }
            : { title: 'No accounts yet', description: 'Open accounts from a customer’s page.' }
        }
        toolbar={
          <FilterBar
            actions={
              <ExportButton
                filename="accounts"
                fetchRows={() =>
                  fetchAll((page) => accountsApi.list({ ...params, page, pageSize: 100 }))
                }
                columns={[
                  { header: 'Account number', value: (a: Account) => a.accountNumber },
                  { header: 'Customer', value: (a) => a.customerName },
                  { header: 'Type', value: (a) => ACCOUNT_TYPE_LABELS[a.type] },
                  { header: 'Plan or product', value: (a) => a.productName },
                  { header: 'Balance (NGN)', value: (a) => toDecimal(a.balance) },
                  { header: 'Status', value: (a) => a.status },
                  { header: 'Opened', value: (a) => formatDate(a.openedAt) },
                  {
                    header: 'Last activity',
                    value: (a) => (a.lastTransactionAt ? formatDate(a.lastTransactionAt) : ''),
                  },
                ]}
              />
            }
          >
            <SearchBox
              label="Search"
              value={list.search}
              onChange={list.setSearch}
              placeholder="Account number or customer name"
            />
            <FilterSelect
              label="Type"
              value={list.filters.type ?? ''}
              onChange={(e) => list.setFilter('type', e.target.value)}
            >
              <option value="">All types</option>
              <option value="savings">Savings</option>
              <option value="target">Target savings</option>
              <option value="thrift">Thrift</option>
              <option value="loan">Loan</option>
            </FilterSelect>
            <FilterSelect
              label="Status"
              value={list.filters.status ?? ''}
              onChange={(e) => list.setFilter('status', e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="dormant">Dormant</option>
              <option value="frozen">Frozen</option>
              <option value="closed">Closed</option>
            </FilterSelect>
            <FilterSelect
              label="Officer"
              value={list.filters.officer ?? ''}
              onChange={(e) => list.setFilter('officer', e.target.value)}
            >
              <option value="">All officers</option>
              {officers.data?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
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
    </>
  )
}
