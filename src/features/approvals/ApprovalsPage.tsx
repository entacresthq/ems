import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { approvalKeys, approvalsApi } from '@/api/operations'
import { DataTable, type Column } from '@/components/data/DataTable'
import { FilterBar, FilterSelect } from '@/components/data/Filters'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { DescriptionList, Money } from '@/components/ui/display'
import { PageHeader } from '@/components/ui/PageHeader'
import { Badge, StatusBadge } from '@/components/ui/StatusBadge'
import { Tabs } from '@/components/ui/Tabs'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { useBranchScope } from '@/features/organisation/BranchScope'
import { useListParams } from '@/hooks/useListParams'
import { formatDateTime } from '@/lib/dates'
import { hasPermission } from '@/lib/permissions'
import {
  APPROVAL_TYPE_LABELS,
  type Approval,
  type ApprovalListParams,
  type ApprovalStatus,
  type ApprovalType,
} from '@/types'
import { ApprovalDecisionButtons } from './ApprovalControls'

export function ApprovalsPage() {
  const user = useCurrentUser()
  const canDecide = hasPermission(user, 'approvals.decide')
  const { branchId } = useBranchScope()
  const list = useListParams(['status', 'type'] as const, {
    filters: { status: 'pending' },
    ordering: '-requested_at',
  })
  const status = (list.filters.status ?? 'pending') as ApprovalStatus
  const [selected, setSelected] = useState<Approval | null>(null)

  const params: ApprovalListParams = {
    page: list.page,
    pageSize: list.pageSize,
    ordering: status === 'pending' ? list.ordering : '-decided_at',
    status,
    type: list.filters.type as ApprovalType | undefined,
    branch: branchId ?? undefined,
  }
  const query = useQuery({
    queryKey: approvalKeys.list(params),
    queryFn: () => approvalsApi.list(params),
    placeholderData: keepPreviousData,
  })
  const pendingCount = useQuery({
    queryKey: approvalKeys.pendingCount(branchId),
    queryFn: () => approvalsApi.pendingCount(branchId),
  })

  const columns: Column<Approval>[] = [
    {
      id: 'when',
      header: status === 'pending' ? 'Requested' : 'Decided',
      cell: (a) =>
        formatDateTime(status === 'pending' ? a.requestedAt : (a.decidedAt ?? a.requestedAt)),
    },
    {
      id: 'type',
      header: 'Type',
      cell: (a) => (
        <Badge
          tone={
            a.type === 'transaction_reversal' || a.type === 'large_withdrawal' ? 'warning' : 'info'
          }
        >
          {APPROVAL_TYPE_LABELS[a.type]}
        </Badge>
      ),
    },
    {
      id: 'subject',
      header: 'Request',
      cell: (a) => <span className="block max-w-md truncate font-medium">{a.subject}</span>,
    },
    { id: 'amount', header: 'Amount', align: 'right', cell: (a) => <Money value={a.amount} /> },
    { id: 'by', header: 'Requested by', cell: (a) => a.requestedByName },
    ...(branchId ? [] : [{ id: 'branch', header: 'Branch', cell: (a: Approval) => a.branchName }]),
    ...(status === 'pending'
      ? []
      : [
          {
            id: 'decider',
            header: status === 'approved' ? 'Approved by' : 'Rejected by',
            cell: (a: Approval) => a.decidedByName ?? '—',
          },
        ]),
  ]

  return (
    <>
      <PageHeader
        title="Approvals"
        description={
          canDecide
            ? 'Requests that need a second person. You cannot approve requests you made yourself.'
            : 'Requests you have made and what happened to them.'
        }
      />
      <Tabs
        label="Approval status"
        value={status}
        onChange={(s) => list.setFilter('status', s)}
        items={[
          { value: 'pending', label: 'Waiting', count: pendingCount.data },
          { value: 'approved', label: 'Approved' },
          { value: 'rejected', label: 'Rejected' },
        ]}
      />
      <div className="mt-4">
        <DataTable
          caption="Approval requests"
          columns={columns}
          rows={query.data?.results}
          getRowId={(a) => a.id}
          isLoading={query.isPending}
          isFetching={query.isFetching}
          error={query.error}
          onRetry={() => void query.refetch()}
          onRowClick={setSelected}
          density="comfortable"
          empty={
            status === 'pending'
              ? {
                  title: 'Nothing waiting for approval',
                  description:
                    'New reversals, closures, large withdrawals and field registrations will appear here.',
                }
              : { title: `No ${status} requests`, description: 'Try another type or branch.' }
          }
          toolbar={
            <FilterBar>
              <FilterSelect
                label="Type"
                value={list.filters.type ?? ''}
                onChange={(e) => list.setFilter('type', e.target.value)}
              >
                <option value="">All types</option>
                {Object.entries(APPROVAL_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
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
      <ApprovalDialog approval={selected} onClose={() => setSelected(null)} />
    </>
  )
}

function ApprovalDialog({
  approval: a,
  onClose,
}: {
  approval: Approval | null
  onClose: () => void
}) {
  return (
    <Dialog
      open={a !== null}
      onClose={onClose}
      title={a ? APPROVAL_TYPE_LABELS[a.type] : ''}
      description={a?.subject}
      footer={
        a && (
          <>
            <Button onClick={onClose}>Close</Button>
            <ApprovalDecisionButtons approval={a} size="md" onDecided={onClose} />
          </>
        )
      }
    >
      {a && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            {a.amount !== null ? (
              <Money value={a.amount} className="text-2xl font-semibold" />
            ) : (
              <span />
            )}
            <StatusBadge status={a.status} />
          </div>
          <DescriptionList
            items={[
              { label: 'Requested by', value: a.requestedByName },
              { label: 'Requested', value: formatDateTime(a.requestedAt) },
              { label: 'Branch', value: a.branchName },
              {
                label: 'Customer',
                value: a.customerId ? (
                  <Link to={`/customers/${a.customerId}`} className="underline underline-offset-2">
                    {a.customerName}
                  </Link>
                ) : null,
              },
              {
                label: 'Account',
                value: a.accountId ? (
                  <Link to={`/accounts/${a.accountId}`} className="underline underline-offset-2">
                    Open account
                  </Link>
                ) : null,
              },
              {
                label: 'Loan',
                value: a.loanId ? (
                  <Link to={`/loans/${a.loanId}`} className="underline underline-offset-2">
                    Open loan
                  </Link>
                ) : null,
              },
              {
                label: 'Transaction',
                value: a.transactionId ? (
                  <Link
                    to={`/transactions?account=${a.accountId}`}
                    className="underline underline-offset-2"
                  >
                    See account transactions
                  </Link>
                ) : null,
              },
              { label: 'Reason given', value: a.reason, wide: true },
              ...(a.status !== 'pending'
                ? [
                    {
                      label: a.status === 'approved' ? 'Approved by' : 'Rejected by',
                      value: a.decidedByName,
                    },
                    { label: 'Decided', value: a.decidedAt ? formatDateTime(a.decidedAt) : null },
                    { label: 'Decision note', value: a.decisionNote, wide: true },
                  ]
                : []),
            ]}
          />
        </div>
      )}
    </Dialog>
  )
}
