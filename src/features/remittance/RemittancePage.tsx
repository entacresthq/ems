import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { isApiError } from '@/api/client'
import { remittanceKeys, remittancesApi } from '@/api/operations'
import { DataTable, type Column } from '@/components/data/DataTable'
import { FilterBar, FilterDate } from '@/components/data/Filters'
import { MoneyInput } from '@/components/form/MoneyInput'
import { TextArea } from '@/components/form/inputs'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Money } from '@/components/ui/display'
import { PageHeader } from '@/components/ui/PageHeader'
import { Badge } from '@/components/ui/StatusBadge'
import { useToast } from '@/components/ui/Toast'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { useBranchScope } from '@/features/organisation/BranchScope'
import { cn } from '@/lib/cn'
import { formatDate, formatTime, todayIso } from '@/lib/dates'
import { formatNaira, kobo, sumKobo, type Kobo } from '@/lib/money'
import { hasPermission } from '@/lib/permissions'
import type { Remittance } from '@/types'

function RemittanceStatus({ r }: { r: Remittance }) {
  if (r.status === 'not_submitted') return <Badge tone="neutral">Not submitted</Badge>
  if (r.status === 'submitted') return <Badge tone="warning">Waiting for count</Badge>
  if (r.variance !== null && r.variance < 0)
    return <Badge tone="danger">Short {formatNaira(kobo(-r.variance))}</Badge>
  if (r.variance !== null && r.variance > 0)
    return <Badge tone="warning">Over {formatNaira(r.variance)}</Badge>
  return <Badge tone="success">Balanced</Badge>
}

export function RemittancePage() {
  const user = useCurrentUser()
  const canConfirm = hasPermission(user, 'remittance.confirm')
  const { branchId } = useBranchScope()
  const [date, setDate] = useState(todayIso())
  const [counting, setCounting] = useState<Remittance | null>(null)
  const params = { date, branch: branchId ?? undefined }
  const query = useQuery({
    queryKey: remittanceKeys.list(params),
    queryFn: () => remittancesApi.list(params),
    placeholderData: keepPreviousData,
  })
  const rows = query.data?.results ?? []

  const expected = sumKobo(rows.map((r) => r.expectedCash))
  const confirmed = rows.filter((r) => r.status === 'confirmed')
  const received = sumKobo(confirmed.map((r) => r.cashReceived ?? kobo(0)))
  const variance = sumKobo(confirmed.map((r) => r.variance ?? kobo(0)))
  const waiting = rows.filter((r) => r.status === 'submitted').length
  const withCollections = rows.filter((r) => r.collectionsCount > 0)
  const notSubmitted = withCollections.filter((r) => r.status === 'not_submitted').length

  const columns: Column<Remittance>[] = [
    {
      id: 'officer',
      header: 'Officer',
      cell: (r) => (
        <span>
          <span className="font-medium">{r.officerName}</span>
          {!branchId && <span className="text-ink-2 block text-xs">{r.branchName}</span>}
        </span>
      ),
    },
    {
      id: 'count',
      header: 'Collections',
      align: 'right',
      cell: (r) =>
        r.collectionsCount > 0 ? (
          <Link
            to={`/transactions?officer=${r.officerId}&date_from=${date}&date_to=${date}&channel=field`}
            className="underline underline-offset-2"
            onClick={(e) => e.stopPropagation()}
          >
            {r.collectionsCount}
          </Link>
        ) : (
          '0'
        ),
    },
    {
      id: 'expected',
      header: 'Expected cash',
      align: 'right',
      cell: (r) => <Money value={r.expectedCash} className="font-medium" />,
    },
    {
      id: 'transfer',
      header: 'Transfers',
      align: 'right',
      cell: (r) => <Money value={r.transferTotal} className="text-ink-2" />,
    },
    {
      id: 'submitted',
      header: 'Submitted',
      cell: (r) => (r.submittedAt ? formatTime(r.submittedAt) : '—'),
    },
    {
      id: 'received',
      header: 'Cash counted',
      align: 'right',
      cell: (r) => <Money value={r.cashReceived} />,
    },
    {
      id: 'variance',
      header: 'Variance',
      align: 'right',
      cell: (r) =>
        r.variance === null ? (
          '—'
        ) : (
          <Money
            value={r.variance}
            signed
            className={cn(r.variance !== 0 && 'font-semibold', r.variance > 0 && 'text-ochre')}
          />
        ),
    },
    { id: 'status', header: 'Status', cell: (r) => <RemittanceStatus r={r} /> },
    {
      id: 'action',
      header: <span className="sr-only">Action</span>,
      cell: (r) =>
        r.status === 'confirmed' ? (
          <span className="text-ink-2 text-xs">{r.confirmedByName}</span>
        ) : canConfirm && r.collectionsCount > 0 ? (
          <Button
            size="sm"
            variant={r.status === 'submitted' ? 'primary' : 'secondary'}
            onClick={() => setCounting(r)}
          >
            Count cash
          </Button>
        ) : null,
    },
  ]

  return (
    <>
      <PageHeader
        title="Remittance"
        description="Count each officer's cash against what they recorded in the field. Transfers are listed for reference and aren't counted."
      />
      <FilterBar>
        <FilterDate
          label="Date"
          value={date}
          max={todayIso()}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
      </FilterBar>

      <dl className="border-rule bg-rule my-4 grid grid-cols-2 gap-px overflow-hidden rounded border lg:grid-cols-4">
        {[
          { label: 'Expected cash', value: <Money value={expected} /> },
          { label: 'Counted so far', value: <Money value={received} /> },
          {
            label: 'Variance on confirmed',
            value: (
              <Money
                value={variance}
                signed
                className={variance < 0 ? 'text-brick' : variance > 0 ? 'text-ochre' : ''}
              />
            ),
          },
          {
            label: 'Officers',
            value: (
              <span className="text-base">
                {confirmed.length} confirmed · {waiting} waiting
                {notSubmitted > 0 && ` · ${notSubmitted} not submitted`}
              </span>
            ),
          },
        ].map((s) => (
          <div key={s.label} className="bg-surface px-4 py-3">
            <dt className="text-ink-2 text-xs font-medium">{s.label}</dt>
            <dd className="tabular mt-1 text-lg font-semibold">{s.value}</dd>
          </div>
        ))}
      </dl>

      {date !== todayIso() && (
        <p className="text-ink-2 mb-3 text-sm">Showing {formatDate(date)}.</p>
      )}

      <DataTable
        caption={`Remittance for ${formatDate(date)}`}
        columns={columns}
        rows={query.data?.results}
        getRowId={(r) => r.officerId}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        density="comfortable"
        empty={{
          title: 'No officers in this branch',
          description: 'Choose another branch at the top of the page.',
        }}
      />
      {counting && <CountCashDialog remittance={counting} onClose={() => setCounting(null)} />}
    </>
  )
}

function CountCashDialog({
  remittance: r,
  onClose,
}: {
  remittance: Remittance
  onClose: () => void
}) {
  // Deliberately empty: the accountant counts independently rather than accepting the expected figure.
  const [cash, setCash] = useState<Kobo | null>(null)
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<{ cash?: string; note?: string; form?: string }>({})
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()
  const toast = useToast()
  const variance = cash === null ? null : kobo(cash - r.expectedCash)

  const submit = async () => {
    const next: typeof errors = {}
    if (cash === null)
      next.cash = 'Enter the cash you counted. Enter 0 if the officer brought nothing.'
    if (variance !== null && variance !== 0 && note.trim().length < 5)
      next.note = 'The cash does not match. Explain the difference before signing off.'
    setErrors(next)
    if (Object.keys(next).length || cash === null) return
    setBusy(true)
    try {
      await remittancesApi.confirm({
        officerId: r.officerId,
        date: r.date,
        cashReceived: cash,
        note: note.trim(),
      })
      await queryClient.invalidateQueries({ queryKey: remittanceKeys.all })
      toast({
        title: 'Remittance signed off',
        description:
          variance === 0
            ? `${r.officerName}: balanced.`
            : `${r.officerName}: ${variance! < 0 ? 'short' : 'over'} by ${formatNaira(kobo(Math.abs(variance!)))}.`,
      })
      onClose()
    } catch (e) {
      setErrors({
        form: isApiError(e)
          ? [...e.formErrors, ...Object.values(e.fieldErrors).flat()].join(' ') || e.message
          : 'Not saved. Try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      size="sm"
      title={`Count cash from ${r.officerName}`}
      description={`${formatDate(r.date)} · ${r.collectionsCount} collections${r.status === 'not_submitted' ? ' · the officer has not submitted yet' : ''}`}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            Sign off remittance
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <div className="border-rule flex items-baseline justify-between border-b pb-3">
          <span className="text-ink-2 text-sm">Expected cash from recorded collections</span>
          <Money value={r.expectedCash} className="text-xl font-semibold" />
        </div>
        <MoneyInput
          label="Cash you counted"
          value={cash}
          onChange={setCash}
          error={errors.cash}
          autoFocus
        />
        {variance !== null && (
          <p
            role="status"
            className={cn(
              'rounded px-3 py-2 text-sm font-semibold',
              variance === 0
                ? 'bg-ledger-tint text-ledger-strong'
                : variance < 0
                  ? 'bg-brick-tint text-brick-strong'
                  : 'bg-ochre-tint text-ochre',
            )}
          >
            {variance === 0
              ? 'Balanced. The cash matches the recorded collections.'
              : `${variance < 0 ? 'Short' : 'Over'} by ${formatNaira(kobo(Math.abs(variance)))}.`}
          </p>
        )}
        {variance !== null && variance !== 0 && (
          <TextArea
            label="Explain the difference"
            hint="For example, what the officer said and what was agreed."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            error={errors.note}
          />
        )}
      </div>
    </Dialog>
  )
}
