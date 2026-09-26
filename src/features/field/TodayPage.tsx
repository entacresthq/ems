import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ChevronRight, RefreshCw } from 'lucide-react'
import { ErrorState, EmptyState, LoadingState } from '@/components/states'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { ProgressBar } from '@/components/ui/display'
import { SegmentedControl } from '@/components/ui/Tabs'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { cn } from '@/lib/cn'
import { formatDate, formatLongDate, formatTime } from '@/lib/dates'
import { amountSizeClass, formatNaira, kobo } from '@/lib/money'
import { useTodayView, type TodayView } from './FieldData'

type Sort = 'area' | 'name' | 'amount'
const SORT_KEY = 'ems:field-sort'

function readSort(): Sort {
  try {
    const v = localStorage.getItem(SORT_KEY)
    return v === 'name' || v === 'amount' ? v : 'area'
  } catch {
    return 'area'
  }
}

export function TodayPage() {
  useDocumentTitle('Today')
  const user = useCurrentUser()
  const { view, isPending, error, refetch, isFetching } = useTodayView()
  const [sort, setSortState] = useState<Sort>(readSort)
  const [hideDone, setHideDone] = useState(false)
  const setSort = (s: Sort) => {
    setSortState(s)
    try {
      localStorage.setItem(SORT_KEY, s)
    } catch {
      // ignore
    }
  }

  if (isPending) return <LoadingState label="Loading today’s list…" />
  if (error || !view) {
    return (
      <ErrorState error={error} title="Couldn't load today's list" onRetry={() => void refetch()} />
    )
  }

  const visible = view.items.filter((i) => !hideDone || !i.done)
  const sorted = [...visible].sort((a, b) => {
    // Customers still to visit come first within any order.
    if (a.done !== b.done) return a.done ? 1 : -1
    if (sort === 'amount') return b.expected + b.arrears - (a.expected + a.arrears)
    if (sort === 'area')
      return a.area.localeCompare(b.area) || a.customerName.localeCompare(b.customerName)
    return a.customerName.localeCompare(b.customerName)
  })
  const groups =
    sort === 'area'
      ? [...new Set(sorted.map((i) => i.area))]
          .sort()
          .map((area) => ({ area, items: sorted.filter((i) => i.area === area) }))
      : [{ area: null, items: sorted }]

  return (
    <>
      <p className="text-ink-2 text-sm">{formatLongDate(new Date())}</p>
      <h1 className="sr-only">Today's collections for {user.firstName}</h1>

      {view.outdated && (
        <Alert tone="warning" className="mt-3" title="This list is not today's">
          It was saved on {formatDate(view.savedAt)}. Connect to the internet to get today's list.
          You can still record collections.
        </Alert>
      )}
      {view.fromCache && !view.outdated && (
        <Alert tone="warning" className="mt-3">
          You're offline. This list was saved at {formatTime(view.savedAt)}. New collections are
          saved on this phone.
        </Alert>
      )}

      <section aria-label="Progress" className="border-rule mt-3 border-b pb-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-ink-2 text-sm">Collected today</p>
            <p
              className={cn(
                amountSizeClass(formatNaira(view.collected, { trimZeroKobo: true }), 'md'),
                'tabular font-semibold',
              )}
            >
              {formatNaira(view.collected, { trimZeroKobo: true })}
            </p>
          </div>
          <div className="text-right">
            <p className="text-ink-2 text-sm">Expected</p>
            <p className="text-ink-2 tabular text-lg font-semibold">
              {formatNaira(view.expected, { trimZeroKobo: true })}
            </p>
          </div>
        </div>
        <div className="mt-3">
          <ProgressBar
            value={view.collected}
            max={view.expected}
            label="Collected against expected"
          />
        </div>
        <p className="text-ink-2 mt-2 text-sm">
          {view.visited} of {view.items.length} customers collected from
        </p>
      </section>

      {view.items.length === 0 ? (
        <EmptyState
          className="mt-4"
          title="Nobody is due today"
          description="No installments or contributions fall on today for your customers. Use Collect to take a payment from anyone on your list."
        />
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-3">
            <SegmentedControl
              label="Sort customers by"
              value={sort}
              onChange={setSort}
              options={[
                { value: 'area', label: 'Area' },
                { value: 'name', label: 'Name' },
                { value: 'amount', label: 'Amount' },
              ]}
            />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-base">
                <input
                  type="checkbox"
                  className="accent-ink size-5"
                  checked={hideDone}
                  onChange={(e) => setHideDone(e.target.checked)}
                />
                Hide collected
              </label>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void refetch()}
                loading={isFetching}
                icon={<RefreshCw className="size-4" aria-hidden />}
              >
                Refresh
              </Button>
            </div>
          </div>

          {groups.map((group) => (
            <section
              key={group.area ?? 'all'}
              aria-label={group.area ?? 'Customers'}
              className="mt-4"
            >
              {group.area && (
                <h2 className="border-ink sticky top-14 z-10 flex justify-between border-b-2 bg-white py-2 text-sm font-semibold">
                  {group.area}
                  <span className="text-ink-2 font-normal">
                    {group.items.filter((i) => !i.done).length} to visit
                  </span>
                </h2>
              )}
              <ul>
                {group.items.map((item) => (
                  <TodayRow key={item.customerId} item={item} />
                ))}
              </ul>
            </section>
          ))}
          {visible.length === 0 && (
            <p className="text-ink-2 mt-6 text-center">
              Everyone on today's list has been collected from.
            </p>
          )}
        </>
      )}
    </>
  )
}

function TodayRow({ item }: { item: TodayView }) {
  const remaining = kobo(item.dues.reduce((n, d) => n + d.remaining, 0))
  const unsent = item.dues.some((d) => d.localCollected > 0)
  // Nothing falls due today but the customer is behind: chase the arrears.
  const arrearsOnly = remaining === 0 && item.arrears > 0
  return (
    <li className="border-rule border-b">
      <Link
        to={`/field/collect/${item.customerId}`}
        className="active:bg-ink-tint flex min-h-20 items-center gap-3 py-3"
      >
        <div className="min-w-0 flex-1">
          <p className={cn('font-semibold', item.done && 'text-ink-2')}>{item.customerName}</p>
          <p className="text-ink-2 truncate text-sm">{item.address}</p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {item.dues
              .filter((d) => d.amountDue > 0)
              .map((d) => (
                <span key={d.accountId}>
                  {d.kind === 'loan' ? 'Loan' : 'Thrift'}{' '}
                  {formatNaira(d.amountDue, { trimZeroKobo: true })}
                </span>
              ))}
            {item.arrears > 0 && (
              <span className="text-brick font-semibold">
                + {formatNaira(item.arrears, { trimZeroKobo: true })} arrears
              </span>
            )}
          </p>
        </div>
        <div className="shrink-0 text-right">
          {item.done ? (
            <span className="text-ledger inline-flex items-center gap-1 font-semibold">
              <Check className="size-5" aria-hidden /> Collected
            </span>
          ) : arrearsOnly ? (
            <span className="text-brick text-sm font-semibold">Arrears only</span>
          ) : (
            <span className="tabular text-xl font-semibold">
              {formatNaira(remaining, { trimZeroKobo: true })}
            </span>
          )}
          {unsent && (
            <span className="text-ochre block text-xs font-semibold">Waiting to sync</span>
          )}
        </div>
        <ChevronRight className="text-ink-3 size-5 shrink-0" aria-hidden />
      </Link>
    </li>
  )
}
