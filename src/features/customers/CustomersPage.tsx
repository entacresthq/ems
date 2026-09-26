import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { customerKeys, customersApi } from '@/api/customers'
import { fetchAll } from '@/api/pagination'
import { DataTable, type Column } from '@/components/data/DataTable'
import { FilterBar, FilterSelect, SearchBox } from '@/components/data/Filters'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Initials } from '@/components/ui/display'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Can } from '@/features/auth/Can'
import { useBranchScope } from '@/features/organisation/BranchScope'
import { ExportButton } from '@/features/shared/ExportButton'
import { useOfficers } from '@/features/shared/lookups'
import { useListParams } from '@/hooks/useListParams'
import { formatDate } from '@/lib/dates'
import { formatPhone } from '@/lib/phone'
import type { Customer, CustomerListParams, CustomerStatus } from '@/types'

const STATUSES: { value: CustomerStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'pending_approval', label: 'Awaiting approval' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'blacklisted', label: 'Blacklisted' },
]

export function CustomersPage() {
  const navigate = useNavigate()
  const { branchId, branches } = useBranchScope()
  const list = useListParams(['status', 'officer', 'area'] as const, { ordering: 'last_name' })
  const officers = useOfficers(branchId)
  const areas = branchId
    ? (branches.find((b) => b.id === branchId)?.areas ?? [])
    : [...new Set(branches.flatMap((b) => b.areas))].sort()

  const params: CustomerListParams = {
    page: list.page,
    pageSize: list.pageSize,
    ordering: list.ordering,
    search: list.search || undefined,
    branch: branchId ?? undefined,
    status: list.filters.status as CustomerStatus | undefined,
    officer: list.filters.officer,
    area: list.filters.area,
  }
  const query = useQuery({
    queryKey: customerKeys.list(params),
    queryFn: () => customersApi.list(params),
    placeholderData: keepPreviousData,
  })

  const columns: Column<Customer>[] = [
    {
      id: 'name',
      header: 'Customer',
      sortKey: 'last_name',
      cell: (c) => (
        <Link
          to={`/customers/${c.id}`}
          className="flex items-center gap-2.5 font-medium hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          <Initials name={`${c.firstName} ${c.lastName}`} src={c.photoUrl} />
          <span>
            {c.firstName} {c.lastName}
            <span className="text-ink-2 block font-mono text-xs font-normal">
              {c.customerNumber}
            </span>
          </span>
        </Link>
      ),
    },
    { id: 'phone', header: 'Phone', cell: (c) => formatPhone(c.phone) },
    { id: 'area', header: 'Area', sortKey: 'area', cell: (c) => c.area },
    { id: 'officer', header: 'Officer', sortKey: 'officer_name', cell: (c) => c.officerName },
    ...(branchId
      ? []
      : [
          {
            id: 'branch',
            header: 'Branch',
            sortKey: 'branch_name',
            cell: (c: Customer) => c.branchName,
          },
        ]),
    { id: 'status', header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
    {
      id: 'joined',
      header: 'Joined',
      sortKey: 'created_at',
      align: 'right',
      cell: (c) => formatDate(c.createdAt),
    },
  ]

  return (
    <>
      <PageHeader
        title="Customers"
        description="Everyone who saves or borrows with us in the branches you can see."
        actions={
          <Can permission="customers.create">
            <ButtonLink
              to="/customers/new"
              variant="primary"
              icon={<Plus className="size-4" aria-hidden />}
            >
              Add customer
            </ButtonLink>
          </Can>
        }
      />
      <DataTable
        caption="Customers"
        columns={columns}
        rows={query.data?.results}
        getRowId={(c) => c.id}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={(c) => navigate(`/customers/${c.id}`)}
        ordering={list.ordering}
        onOrderingChange={list.setOrdering}
        density="comfortable"
        empty={
          list.hasFilters
            ? {
                title: 'No customers match these filters',
                description:
                  'Check the spelling, or search by phone, customer number or BVN instead.',
                action: (
                  <Button size="sm" onClick={list.clearFilters}>
                    Clear filters
                  </Button>
                ),
              }
            : {
                title: 'No customers yet',
                description:
                  'Add the first customer, or wait for officers to register customers in the field.',
              }
        }
        toolbar={
          <FilterBar
            actions={
              <ExportButton
                filename="customers"
                fetchRows={() =>
                  fetchAll((page) => customersApi.list({ ...params, page, pageSize: 100 }))
                }
                columns={[
                  { header: 'Customer number', value: (c: Customer) => c.customerNumber },
                  { header: 'First name', value: (c) => c.firstName },
                  { header: 'Last name', value: (c) => c.lastName },
                  { header: 'Phone', value: (c) => c.phone },
                  { header: 'Area', value: (c) => c.area },
                  { header: 'Address', value: (c) => c.address },
                  { header: 'Officer', value: (c) => c.officerName },
                  { header: 'Branch', value: (c) => c.branchName },
                  { header: 'Status', value: (c) => c.status },
                  { header: 'Joined', value: (c) => formatDate(c.createdAt) },
                ]}
              />
            }
          >
            <SearchBox
              label="Search"
              value={list.search}
              onChange={list.setSearch}
              placeholder="Name, phone, customer no. or BVN"
            />
            <FilterSelect
              label="Status"
              value={list.filters.status ?? ''}
              onChange={(e) => list.setFilter('status', e.target.value)}
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
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
                  {branchId ? '' : ` (${o.branchName})`}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              label="Area"
              value={list.filters.area ?? ''}
              onChange={(e) => list.setFilter('area', e.target.value)}
            >
              <option value="">All areas</option>
              {areas.map((a) => (
                <option key={a} value={a}>
                  {a}
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
