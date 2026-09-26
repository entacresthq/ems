import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { fetchAll } from '@/api/pagination'
import { loanKeys, loanProductKeys, loanProductsApi, loansApi } from '@/api/loans'
import { DataTable, type Column } from '@/components/data/DataTable'
import { FilterBar, FilterSelect, SearchBox } from '@/components/data/Filters'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Money } from '@/components/ui/display'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Tabs } from '@/components/ui/Tabs'
import { Can } from '@/features/auth/Can'
import { useBranchScope } from '@/features/organisation/BranchScope'
import { ExportButton } from '@/features/shared/ExportButton'
import { useOfficers } from '@/features/shared/lookups'
import { useListParams } from '@/hooks/useListParams'
import { cn } from '@/lib/cn'
import { formatDate, todayIso } from '@/lib/dates'
import { toDecimal } from '@/lib/money'
import type { Loan, LoanListParams, LoanStatus } from '@/types'
import { tenorLabel } from './LoanProductsPage'

type View = 'active' | 'arrears' | 'expiring' | 'pending_approval' | 'approved' | 'all'

const VIEWS: { value: View; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'arrears', label: 'In arrears' },
  { value: 'expiring', label: 'Ending soon' },
  { value: 'pending_approval', label: 'Waiting for approval' },
  { value: 'approved', label: 'Ready to pay out' },
  { value: 'all', label: 'All loans' },
]

export function LoansPage() {
  const navigate = useNavigate()
  const { branchId } = useBranchScope()
  const officers = useOfficers(branchId)
  const products = useQuery({
    queryKey: loanProductKeys.list(),
    queryFn: () => loanProductsApi.list(),
  })
  const list = useListParams(['view', 'product', 'officer'] as const, {
    filters: { view: 'active' },
  })
  const view = (list.filters.view ?? 'active') as View
  const today = todayIso()

  const params: LoanListParams = {
    page: list.page,
    pageSize: list.pageSize,
    ordering:
      list.ordering ??
      (view === 'arrears'
        ? '-days_in_arrears'
        : view === 'expiring'
          ? 'maturity_date'
          : '-created_at'),
    search: list.search || undefined,
    branch: branchId ?? undefined,
    product: list.filters.product,
    officer: list.filters.officer,
    status:
      view === 'active' || view === 'arrears' || view === 'expiring'
        ? 'active'
        : view === 'all'
          ? undefined
          : (view as LoanStatus),
    view: view === 'arrears' || view === 'expiring' ? view : undefined,
  }
  const query = useQuery({
    queryKey: loanKeys.list(params),
    queryFn: () => loansApi.list(params),
    placeholderData: keepPreviousData,
  })

  const columns: Column<Loan>[] = [
    {
      id: 'number',
      header: 'Loan',
      cell: (l) => (
        <Link
          to={`/loans/${l.id}`}
          className="font-mono font-medium hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {l.loanNumber}
        </Link>
      ),
    },
    { id: 'customer', header: 'Customer', sortKey: 'customer_name', cell: (l) => l.customerName },
    {
      id: 'product',
      header: 'Product',
      cell: (l) => `${l.productName} · ${tenorLabel(l.installmentCount, l.frequency)}`,
    },
    {
      id: 'principal',
      header: 'Amount',
      sortKey: 'principal',
      align: 'right',
      cell: (l) => <Money value={l.principal} />,
    },
    {
      id: 'outstanding',
      header: 'Outstanding',
      sortKey: 'outstanding',
      align: 'right',
      cell: (l) =>
        l.status === 'active' ? <Money value={l.outstanding} className="font-medium" /> : '—',
    },
    {
      id: 'arrears',
      header: 'Arrears',
      sortKey: 'days_in_arrears',
      align: 'right',
      cell: (l) =>
        l.arrears > 0 ? (
          <span className="text-brick font-medium">
            <Money value={l.arrears} /> <span className="text-xs">· {l.daysInArrears}d</span>
          </span>
        ) : (
          '—'
        ),
    },
    {
      id: 'maturity',
      header: 'Final installment',
      sortKey: 'maturity_date',
      cell: (l) =>
        l.maturityDate ? (
          <span
            className={cn(
              l.status === 'active' && l.maturityDate < today && 'text-brick font-medium',
            )}
          >
            {formatDate(l.maturityDate)}
          </span>
        ) : (
          '—'
        ),
    },
    { id: 'status', header: 'Status', cell: (l) => <StatusBadge status={l.status} /> },
  ]

  return (
    <>
      <PageHeader
        title="Loans"
        description="Applications, approvals, payouts and repayment across the branches you can see."
        actions={
          <Can permission="loans.apply">
            <ButtonLink
              to="/loans/new"
              variant="primary"
              icon={<Plus className="size-4" aria-hidden />}
            >
              New loan application
            </ButtonLink>
          </Can>
        }
      />
      <Tabs
        label="Loan view"
        value={view}
        onChange={(v) => list.setFilter('view', v)}
        items={VIEWS}
      />
      <div className="mt-4">
        <DataTable
          caption="Loans"
          columns={columns}
          rows={query.data?.results}
          getRowId={(l) => l.id}
          isLoading={query.isPending}
          isFetching={query.isFetching}
          error={query.error}
          onRetry={() => void query.refetch()}
          onRowClick={(l) => navigate(`/loans/${l.id}`)}
          ordering={list.ordering}
          onOrderingChange={list.setOrdering}
          empty={
            view === 'arrears'
              ? { title: 'No loans in arrears', description: 'Every active loan is up to date.' }
              : view === 'expiring'
                ? {
                    title: 'No loans ending in the next 14 days',
                    description: 'Loans whose final installment is near or has passed appear here.',
                  }
                : list.hasFilters
                  ? {
                      title: 'No loans match these filters',
                      action: (
                        <Button size="sm" onClick={list.clearFilters}>
                          Clear filters
                        </Button>
                      ),
                    }
                  : {
                      title: 'No loans here',
                      description: 'New applications appear under “Waiting for approval”.',
                    }
          }
          toolbar={
            <FilterBar
              actions={
                <ExportButton
                  filename={`loans-${view}`}
                  fetchRows={() =>
                    fetchAll((page) => loansApi.list({ ...params, page, pageSize: 100 }))
                  }
                  columns={[
                    { header: 'Loan number', value: (l: Loan) => l.loanNumber },
                    { header: 'Customer', value: (l) => l.customerName },
                    { header: 'Product', value: (l) => l.productName },
                    { header: 'Principal (NGN)', value: (l) => toDecimal(l.principal) },
                    { header: 'Total repayable (NGN)', value: (l) => toDecimal(l.totalRepayable) },
                    { header: 'Paid (NGN)', value: (l) => toDecimal(l.amountPaid) },
                    { header: 'Outstanding (NGN)', value: (l) => toDecimal(l.outstanding) },
                    { header: 'Arrears (NGN)', value: (l) => toDecimal(l.arrears) },
                    { header: 'Days in arrears', value: (l) => l.daysInArrears },
                    {
                      header: 'Disbursed',
                      value: (l) => (l.disbursedAt ? formatDate(l.disbursedAt) : ''),
                    },
                    {
                      header: 'Final installment',
                      value: (l) => (l.maturityDate ? formatDate(l.maturityDate) : ''),
                    },
                    { header: 'Status', value: (l) => l.status },
                  ]}
                />
              }
            >
              <SearchBox
                label="Search"
                value={list.search}
                onChange={list.setSearch}
                placeholder="Loan number, customer or account"
              />
              <FilterSelect
                label="Product"
                value={list.filters.product ?? ''}
                onChange={(e) => list.setFilter('product', e.target.value)}
              >
                <option value="">All products</option>
                {products.data?.results.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
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
      </div>
    </>
  )
}
