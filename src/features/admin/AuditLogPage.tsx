import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { adminKeys, auditApi } from '@/api/admin'
import { fetchAll } from '@/api/pagination'
import { DataTable, type Column } from '@/components/data/DataTable'
import { FilterBar, FilterDate, FilterSelect, SearchBox } from '@/components/data/Filters'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { useBranchScope } from '@/features/organisation/BranchScope'
import { ExportButton } from '@/features/shared/ExportButton'
import { useListParams } from '@/hooks/useListParams'
import { formatDateTime } from '@/lib/dates'
import { ROLE_LABELS, type AuditEntry, type AuditListParams } from '@/types'

const AREAS = [
  ['auth', 'Sign-ins and passwords'],
  ['customer', 'Customers'],
  ['account', 'Accounts'],
  ['collection', 'Field collections'],
  ['transaction', 'Counter postings'],
  ['loan', 'Loans'],
  ['approval', 'Approvals'],
  ['remittance', 'Remittance'],
  ['staff', 'Staff'],
  ['branch', 'Branches'],
  ['settings', 'Settings'],
  ['thrift_plan', 'Thrift plans'],
  ['loan_product', 'Loan products'],
] as const

/** Read-only record of who did what, when and from where. */
export function AuditLogPage() {
  const { branchId } = useBranchScope()
  const list = useListParams(['action', 'date_from', 'date_to'] as const)
  const params: AuditListParams = {
    page: list.page,
    pageSize: list.pageSize,
    search: list.search || undefined,
    action: list.filters.action,
    dateFrom: list.filters.date_from,
    dateTo: list.filters.date_to,
    branch: branchId ?? undefined,
  }
  const query = useQuery({
    queryKey: adminKeys.audit(params),
    queryFn: () => auditApi.list(params),
    placeholderData: keepPreviousData,
  })

  const columns: Column<AuditEntry>[] = [
    { id: 'at', header: 'When', cell: (a) => formatDateTime(a.at) },
    {
      id: 'who',
      header: 'Who',
      cell: (a) => (
        <span>
          {a.actorName}
          <span className="text-ink-2 block text-xs">
            {a.actorRole ? ROLE_LABELS[a.actorRole] : 'System'}
          </span>
        </span>
      ),
    },
    {
      id: 'action',
      header: 'Action',
      cell: (a) => <span className="font-mono text-xs">{a.action}</span>,
    },
    {
      id: 'summary',
      header: 'What happened',
      cell: (a) => <span className="block max-w-lg whitespace-normal">{a.summary}</span>,
    },
    {
      id: 'from',
      header: 'From',
      cell: (a) => (
        <span>
          <span className="font-mono text-xs">{a.ipAddress}</span>
          <span className="text-ink-2 block text-xs">{a.userAgent}</span>
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every sign-in and change, with who made it and from which device. Entries can't be edited or deleted."
      />
      <DataTable
        caption="Audit log"
        columns={columns}
        rows={query.data?.results}
        getRowId={(a) => a.id}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        density="comfortable"
        empty={
          list.hasFilters
            ? {
                title: 'No entries match',
                description: 'Widen the dates or clear the filters.',
                action: (
                  <Button size="sm" onClick={list.clearFilters}>
                    Clear filters
                  </Button>
                ),
              }
            : { title: 'Nothing recorded yet' }
        }
        toolbar={
          <FilterBar
            actions={
              <ExportButton
                filename="audit-log"
                fetchRows={() =>
                  fetchAll((page) => auditApi.list({ ...params, page, pageSize: 100 }))
                }
                columns={[
                  { header: 'When', value: (a: AuditEntry) => formatDateTime(a.at) },
                  { header: 'Who', value: (a) => a.actorName },
                  { header: 'Role', value: (a) => (a.actorRole ? ROLE_LABELS[a.actorRole] : '') },
                  { header: 'Action', value: (a) => a.action },
                  { header: 'What happened', value: (a) => a.summary },
                  { header: 'IP address', value: (a) => a.ipAddress },
                  { header: 'Device', value: (a) => a.userAgent },
                ]}
              />
            }
          >
            <SearchBox
              label="Search"
              value={list.search}
              onChange={list.setSearch}
              placeholder="Name, detail or IP address"
            />
            <FilterSelect
              label="Area"
              value={list.filters.action ?? ''}
              onChange={(e) => list.setFilter('action', e.target.value)}
            >
              <option value="">Everything</option>
              {AREAS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </FilterSelect>
            <FilterDate
              label="From"
              value={list.filters.date_from ?? ''}
              onChange={(e) => list.setFilter('date_from', e.target.value)}
            />
            <FilterDate
              label="To"
              value={list.filters.date_to ?? ''}
              onChange={(e) => list.setFilter('date_to', e.target.value)}
            />
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
