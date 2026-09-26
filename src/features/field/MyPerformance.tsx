import { useQuery } from '@tanstack/react-query'
import { insightKeys, insightsApi } from '@/api/insights'
import { ProgressBar } from '@/components/ui/display'
import { cn } from '@/lib/cn'
import { formatNaira } from '@/lib/money'
import type { PeriodPerformance } from '@/types'

function Period({ label, p }: { label: string; p: PeriodPerformance }) {
  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-semibold">{label}</p>
        <p className={cn('tabular text-xl font-semibold', p.ratePercent < 70 && 'text-brick')}>
          {p.ratePercent}%
        </p>
      </div>
      <p className="text-ink-2 text-sm">
        {formatNaira(p.collected, { trimZeroKobo: true })} collected of{' '}
        {formatNaira(p.expected, { trimZeroKobo: true })} due
      </p>
      <div className="mt-2">
        <ProgressBar
          value={p.collected}
          max={p.expected}
          label={`${label}: collected against due`}
        />
      </div>
    </div>
  )
}

/** Collections against what fell due this week and month, and PAR on the officer's loans. */
export function MyPerformance() {
  const query = useQuery({
    queryKey: insightKeys.performance(),
    queryFn: insightsApi.performance,
    networkMode: 'always',
    retry: false,
  })
  return (
    <section className="border-ink mt-6 border-t-2">
      <p className="pt-3 text-sm font-semibold">My performance</p>
      {query.isPending ? (
        <p className="text-ink-2 py-3">Loading…</p>
      ) : query.isError ? (
        <p className="text-ink-2 py-3">Connect to the internet to see your performance.</p>
      ) : (
        <>
          <div className="divide-rule divide-y">
            <Period label="This week" p={query.data.week} />
            <Period label="This month" p={query.data.month} />
          </div>
          <dl className="border-rule mt-1 grid grid-cols-3 gap-2 border-t pt-3 text-center">
            {(
              [
                ['PAR 1', query.data.portfolio.par1Percent],
                ['PAR 7', query.data.portfolio.par7Percent],
                ['PAR 30', query.data.portfolio.par30Percent],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="text-ink-2 text-xs">{label}</dt>
                <dd className={cn('tabular text-lg font-semibold', value >= 10 && 'text-brick')}>
                  {value}%
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-ink-2 mt-2 text-sm">
            {query.data.portfolio.count} active loans,{' '}
            {formatNaira(query.data.portfolio.portfolio, { trimZeroKobo: true })} outstanding. PAR
            is the share of that balance owed by customers who are behind.
          </p>
        </>
      )}
    </section>
  )
}
