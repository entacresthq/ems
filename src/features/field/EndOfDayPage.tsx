import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'
import { fieldApi, fieldKeys } from '@/api/field'
import { remittancesApi } from '@/api/operations'
import { ErrorState, LoadingState } from '@/components/states'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { formatDateTime, formatLongDate, formatTime, todayIso } from '@/lib/dates'
import { amountSizeClass, formatNaira, kobo, type Kobo } from '@/lib/money'
import { cn } from '@/lib/cn'
import type { DaySummary } from '@/types'
import { useFieldData } from './FieldData'
import { discardEntry, retryEntry } from './offline/outbox'

export function EndOfDayPage() {
  useDocumentTitle('End of day')
  const day = todayIso()
  const online = useOnlineStatus()
  const { entries, unsyncedCount, sync, syncing } = useFieldData()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const summary = useQuery({
    queryKey: fieldKeys.daySummary(day),
    queryFn: () => fieldApi.daySummary(day),
    networkMode: 'always',
    retry: false,
  })

  const todays = entries.filter((e) => e.day === day)
  const unsent = todays.filter((e) => e.status === 'pending' || e.status === 'syncing')
  const failed = entries.filter((e) => e.status === 'failed')
  const unsentTotal = kobo(unsent.reduce((n, e) => n + e.amount, 0))
  const unsentCash = kobo(
    unsent.filter((e) => e.paymentMethod === 'cash').reduce((n, e) => n + e.amount, 0),
  )

  const refresh = () => queryClient.invalidateQueries({ queryKey: fieldKeys.all })

  return (
    <>
      <p className="text-ink-2 text-sm">{formatLongDate(new Date())}</p>
      <h1 className="text-xl font-semibold">End of day</h1>

      {unsyncedCount > 0 && (
        <Alert
          tone="warning"
          className="mt-4"
          title={`${unsyncedCount} ${unsyncedCount === 1 ? 'collection is' : 'collections are'} still on this phone`}
          action={
            <Button
              size="sm"
              onClick={() => void sync().then(refresh)}
              loading={syncing}
              disabled={!online}
              icon={<RefreshCw className="size-4" aria-hidden />}
            >
              Sync now
            </Button>
          }
        >
          {formatNaira(unsentTotal)} hasn't reached the office yet.{' '}
          {online ? 'Sync before you submit.' : 'Find network, then sync before you submit.'}
        </Alert>
      )}

      {failed.length > 0 && (
        <section className="border-brick bg-brick-tint mt-4 border-l-4 px-4 py-3">
          <p className="text-brick-strong flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-5" aria-hidden /> {failed.length}{' '}
            {failed.length === 1 ? 'collection was' : 'collections were'} not accepted
          </p>
          <ul className="mt-2 flex flex-col gap-3">
            {failed.map((e) => (
              <li key={e.key} className="text-sm">
                <p className="font-semibold">
                  {e.customerName} · {formatNaira(e.amount)} · {formatTime(e.collectedAt)}
                </p>
                <p>{e.error}</p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={() => void retryEntry(e.key).then(() => sync())}>
                    Try again
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void discardEntry(e.key)}>
                    Remove, I gave the cash to the accountant
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {summary.isPending ? (
        <LoadingState label="Adding up your day…" />
      ) : summary.error || !summary.data ? (
        <div className="mt-4">
          {online ? (
            <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
          ) : (
            <Alert tone="warning" title="Offline">
              Connect to see the office's totals and submit your remittance. This phone holds{' '}
              {todays.length} of today's collections (
              {formatNaira(kobo(todays.reduce((n, e) => n + e.amount, 0)))}).
            </Alert>
          )}
        </div>
      ) : (
        <DaySummaryView
          summary={summary.data}
          unsentTotal={unsentTotal}
          unsentCash={unsentCash}
          canSubmit={unsyncedCount === 0 && online}
          onSubmit={() => setConfirming(true)}
        />
      )}

      {summary.data && (
        <ConfirmDialog
          open={confirming}
          onClose={() => setConfirming(false)}
          title="Submit today's remittance?"
          confirmLabel="Submit for remittance"
          onConfirm={async () => {
            await remittancesApi.submit(day)
            await refresh()
            toast({
              title: 'Remittance submitted',
              description: `Hand ${formatNaira(summary.data.cashTotal)} cash to the accountant.`,
            })
          }}
        >
          <p className="text-ink">
            Hand <strong className="tabular">{formatNaira(summary.data.cashTotal)}</strong> in cash
            to the accountant. Transfers of {formatNaira(summary.data.transferTotal)} are already in
            the bank.
          </p>
          <p>The accountant counts the cash against these figures and signs off.</p>
        </ConfirmDialog>
      )}
    </>
  )
}

function DaySummaryView({
  summary: s,
  unsentTotal,
  unsentCash,
  canSubmit,
  onSubmit,
}: {
  summary: DaySummary
  unsentTotal: Kobo
  unsentCash: Kobo
  canSubmit: boolean
  onSubmit: () => void
}) {
  const r = s.remittance
  const submitted = r && r.status !== 'not_submitted'
  return (
    <>
      <section className="border-rule mt-4 border-b pb-4">
        <p className="text-ink-2 text-sm">Total collected</p>
        <p
          className={cn(
            amountSizeClass(formatNaira(s.totalCollected, { trimZeroKobo: true }), 'md'),
            'tabular font-semibold',
          )}
        >
          {formatNaira(s.totalCollected, { trimZeroKobo: true })}
        </p>
        {unsentTotal > 0 && (
          <p className="text-ochre text-sm font-semibold">
            + {formatNaira(unsentTotal, { trimZeroKobo: true })} still on this phone
          </p>
        )}
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <div className="border-ink border-l-4 pl-3">
            <dt className="text-ink-2 text-sm">Cash to hand in</dt>
            <dd className="text-amount-sm tabular font-semibold">
              {formatNaira(s.cashTotal, { trimZeroKobo: true })}
            </dd>
            {unsentCash > 0 && (
              <dd className="text-ochre text-xs">
                + {formatNaira(unsentCash, { trimZeroKobo: true })} unsynced
              </dd>
            )}
          </div>
          <div className="border-rule-strong border-l-4 pl-3">
            <dt className="text-ink-2 text-sm">Transfers</dt>
            <dd className="text-amount-sm tabular font-semibold">
              {formatNaira(s.transferTotal, { trimZeroKobo: true })}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-base">
          <strong>{s.customersVisited}</strong> of {s.customersDue} customers due today collected
          from · {s.collectionsCount} collections
        </p>
      </section>

      {s.missed.length > 0 && (
        <section className="mt-4">
          <h2 className="border-ink border-b-2 pb-2 text-sm font-semibold">
            Missed today ({s.missed.length})
          </h2>
          <ul>
            {s.missed.map((m) => (
              <li key={m.customerId} className="border-rule border-b">
                <Link
                  to={`/field/collect/${m.customerId}`}
                  className="flex min-h-14 items-center justify-between gap-3 py-2"
                >
                  <span>
                    <span className="block font-semibold">{m.customerName}</span>
                    <span className="text-ink-2 text-sm">{m.area}</span>
                  </span>
                  <span className="tabular font-semibold">
                    {formatNaira(m.amountDue, { trimZeroKobo: true })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        {submitted ? (
          <div className="border-ledger bg-ledger-tint border-l-4 px-4 py-3">
            <p className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="text-ledger size-5" aria-hidden />
              {r.status === 'confirmed' ? 'Remittance confirmed' : 'Remittance submitted'}
            </p>
            {r.status === 'submitted' && (
              <p className="mt-1">
                Submitted at {formatTime(r.submittedAt!)}. Hand {formatNaira(r.expectedCash)} to the
                accountant for counting.
              </p>
            )}
            {r.status === 'confirmed' && (
              <p className="mt-1">
                {r.confirmedByName} counted {formatNaira(r.cashReceived!)} at{' '}
                {formatDateTime(r.confirmedAt!)}.
                {r.variance !== null && r.variance !== 0 && (
                  <span className="text-brick block font-semibold">
                    {r.variance < 0 ? 'Short by' : 'Over by'}{' '}
                    {formatNaira(kobo(Math.abs(r.variance)))}. {r.note}
                  </span>
                )}
              </p>
            )}
          </div>
        ) : s.collectionsCount === 0 ? (
          <p className="text-ink-2">
            Nothing to submit yet. Collections you record today will appear here.
          </p>
        ) : (
          <>
            <Button variant="ink" size="xl" onClick={onSubmit} disabled={!canSubmit}>
              Submit for remittance
            </Button>
            {!canSubmit && (
              <p className="text-ink-2 mt-2 text-sm">Sync every collection on this phone first.</p>
            )}
          </>
        )}
      </section>
    </>
  )
}
