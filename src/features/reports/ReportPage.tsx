import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { Download, FileSpreadsheet, FileText, Printer } from 'lucide-react'
import { adminKeys, settingsApi } from '@/api/admin'
import { isApiError } from '@/api/client'
import { insightKeys, insightsApi } from '@/api/insights'
import { FilterBar, FilterDate, FilterSelect } from '@/components/data/Filters'
import { TextInput } from '@/components/form/inputs'
import { EmptyState, ErrorState, LoadingState } from '@/components/states'
import { Button } from '@/components/ui/Button'
import { BackLink } from '@/components/ui/display'
import { PageHeader } from '@/components/ui/PageHeader'
import { useToast } from '@/components/ui/Toast'
import { useBranchScope } from '@/features/organisation/BranchScope'
import { useOfficers } from '@/features/shared/lookups'
import { NotFoundPage } from '@/features/errors/ErrorPages'
import { useListParams } from '@/hooks/useListParams'
import { cn } from '@/lib/cn'
import { addDays, weekday } from '@/lib/loans'
import { formatDate, formatDateTime, todayIso } from '@/lib/dates'
import { reportByKey } from '@/lib/reportCatalogue'
import { cellText, exportCsv, exportPdf, exportXlsx, type ReportMeta } from '@/lib/reportExport'
import type { ReportQuery, ReportResult } from '@/types'

function presets(today: string) {
  const monday = addDays(today, -((weekday(today) + 6) % 7))
  const monthStart = `${today.slice(0, 8)}01`
  const lastMonthEnd = addDays(monthStart, -1)
  return [
    { label: 'Today', from: today, to: today },
    { label: 'This week', from: monday, to: today },
    { label: 'This month', from: monthStart, to: today },
    { label: 'Last month', from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd },
  ]
}

export function ReportPage() {
  const { key = '' } = useParams()
  const def = reportByKey(key)
  if (!def) return <NotFoundPage />
  return <ReportView reportKey={key} />
}

function ReportView({ reportKey }: { reportKey: string }) {
  const def = reportByKey(reportKey)!
  const today = todayIso()
  const { branchId, branches } = useBranchScope()
  const officers = useOfficers(branchId, def.filters.includes('officer'))
  const settings = useQuery({
    queryKey: adminKeys.settings,
    queryFn: settingsApi.get,
    staleTime: 10 * 60_000,
  })
  const list = useListParams(['date_from', 'date_to', 'officer', 'account', 'min_days'] as const, {
    filters: { date_from: `${today.slice(0, 8)}01`, date_to: today, min_days: '30' },
  })
  const f = list.filters
  const [accountInput, setAccountInput] = useState(f.account ?? '')
  const [exporting, setExporting] = useState<string | null>(null)
  const toast = useToast()

  const query: ReportQuery = {
    branch: branchId ?? undefined,
    ...(def.filters.includes('period') ? { dateFrom: f.date_from, dateTo: f.date_to } : {}),
    ...(def.filters.includes('officer') && f.officer ? { officer: f.officer } : {}),
    ...(def.filters.includes('account') ? { accountNumber: f.account } : {}),
    ...(def.filters.includes('minDays') ? { minDays: Number(f.min_days) || 30 } : {}),
  }
  const needsAccount = def.filters.includes('account') && !f.account
  const result = useQuery({
    queryKey: insightKeys.report(reportKey, query),
    queryFn: () => insightsApi.report(reportKey, query),
    enabled: !needsAccount,
    placeholderData: keepPreviousData,
  })

  const officerName = officers.data?.find((o) => o.id === f.officer)?.name
  const meta: ReportMeta = {
    businessName: settings.data?.businessName ?? 'EMS',
    scope: [
      branchId ? `${branches.find((b) => b.id === branchId)?.name ?? ''} branch` : 'All branches',
      officerName,
    ]
      .filter(Boolean)
      .join(' · '),
  }

  const run = async (kind: 'csv' | 'xlsx' | 'pdf', r: ReportResult) => {
    setExporting(kind)
    try {
      if (kind === 'csv') exportCsv(r)
      if (kind === 'xlsx') await exportXlsx(r, meta)
      if (kind === 'pdf') await exportPdf(r, meta)
    } catch {
      toast({
        tone: 'danger',
        title: 'Export failed',
        description: 'Try again. If it keeps failing, use CSV.',
      })
    } finally {
      setExporting(null)
    }
  }

  const r = result.data
  return (
    <>
      <div className="print:hidden">
        <BackLink to="/reports">Reports</BackLink>
      </div>
      <PageHeader
        title={def.title}
        description={def.description}
        actions={
          r && (
            <div className="flex flex-wrap gap-2 print:hidden">
              <Button
                icon={<Download className="size-4" aria-hidden />}
                loading={exporting === 'csv'}
                onClick={() => run('csv', r)}
              >
                CSV
              </Button>
              <Button
                icon={<FileSpreadsheet className="size-4" aria-hidden />}
                loading={exporting === 'xlsx'}
                onClick={() => run('xlsx', r)}
              >
                Excel
              </Button>
              <Button
                icon={<FileText className="size-4" aria-hidden />}
                loading={exporting === 'pdf'}
                onClick={() => run('pdf', r)}
              >
                PDF
              </Button>
              <Button
                icon={<Printer className="size-4" aria-hidden />}
                onClick={() => window.print()}
              >
                Print
              </Button>
            </div>
          )
        }
      />

      <div className="mb-4 print:hidden">
        <FilterBar>
          {def.filters.includes('account') && (
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                list.setFilter(
                  'account',
                  accountInput.replace(/[^A-Za-z0-9-]/g, '').toUpperCase() || undefined,
                )
              }}
            >
              <TextInput
                label="Account number"
                autoCapitalize="characters"
                maxLength={24}
                className="h-9 font-mono"
                value={accountInput}
                onChange={(e) => setAccountInput(e.target.value)}
                containerClassName="gap-1 [&_label]:text-xs [&_label]:text-ink-2"
              />
              <Button type="submit" variant="primary">
                Show statement
              </Button>
            </form>
          )}
          {def.filters.includes('period') && (
            <>
              <FilterDate
                label="From"
                value={f.date_from ?? ''}
                max={f.date_to}
                onChange={(e) => e.target.value && list.setFilter('date_from', e.target.value)}
              />
              <FilterDate
                label="To"
                value={f.date_to ?? ''}
                min={f.date_from}
                max={today}
                onChange={(e) => e.target.value && list.setFilter('date_to', e.target.value)}
              />
              <div className="flex flex-wrap gap-1 self-end">
                {presets(today).map((p) => {
                  const active = f.date_from === p.from && f.date_to === p.to
                  return (
                    <button
                      key={p.label}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        list.setFilter('date_from', p.from)
                        list.setFilter('date_to', p.to)
                      }}
                      className={cn(
                        'h-9 rounded border px-3 text-sm',
                        active
                          ? 'border-ink bg-ink text-white'
                          : 'border-rule-strong bg-surface hover:bg-ink-tint',
                      )}
                    >
                      {p.label}
                    </button>
                  )
                })}
              </div>
            </>
          )}
          {def.filters.includes('officer') && (
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
          )}
          {def.filters.includes('minDays') && (
            <FilterSelect
              label="Behind by at least"
              value={f.min_days ?? '30'}
              onChange={(e) => list.setFilter('min_days', e.target.value)}
            >
              {[1, 7, 30, 60, 90].map((d) => (
                <option key={d} value={d}>
                  {d} {d === 1 ? 'day' : 'days'}
                </option>
              ))}
            </FilterSelect>
          )}
        </FilterBar>
      </div>

      {needsAccount ? (
        <EmptyState
          title="Enter an account number"
          description="Type the account number above to see its statement for the chosen dates."
        />
      ) : result.isPending ? (
        <LoadingState label="Running the report…" />
      ) : result.isError ? (
        <ErrorState
          error={result.error}
          onRetry={() => void result.refetch()}
          title={
            isApiError(result.error) && result.error.status === 400
              ? 'Check the filters'
              : "Couldn't run this report"
          }
        />
      ) : r ? (
        <ReportTable result={r} meta={meta} fetching={result.isFetching} />
      ) : null}
    </>
  )
}

function ReportTable({
  result: r,
  meta,
  fetching,
}: {
  result: ReportResult
  meta: ReportMeta
  fetching: boolean
}) {
  const numeric = (t: string) => t === 'money' || t === 'number' || t === 'percent'
  return (
    <section aria-label={r.title} className={cn(fetching && 'opacity-60')}>
      {/* Printed heading. */}
      <div className="mb-3 hidden print:block">
        <p className="text-sm font-semibold">{meta.businessName}</p>
        <p className="text-lg font-semibold">{r.title}</p>
      </div>
      <p className="text-ink-2 mb-2 text-sm">
        {meta.scope} ·{' '}
        {r.period ? `${formatDate(r.period.from)} to ${formatDate(r.period.to)}` : 'As at today'} ·
        generated {formatDateTime(r.generatedAt)}
      </p>
      {r.rows.length === 0 ? (
        <EmptyState
          className="border-rule bg-surface rounded border"
          title="Nothing to report"
          description="No records match these filters. Widen the dates or choose another officer."
        />
      ) : (
        <div
          className="border-rule bg-surface overflow-auto rounded border print:overflow-visible print:border-0"
          style={{ maxHeight: 'calc(100dvh - 16rem)' }}
        >
          <table className="w-full border-collapse text-sm print:text-xs">
            <thead className="bg-surface sticky top-0 shadow-[inset_0_-1px_0_var(--color-rule-strong)] print:static">
              <tr>
                {r.columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={cn(
                      'text-ink-2 px-3 py-2 text-xs font-semibold whitespace-nowrap',
                      numeric(c.type) ? 'text-right' : 'text-left',
                    )}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.rows.map((row, i) => (
                <tr
                  key={i}
                  className="border-rule hover:bg-paper border-b last:border-0 print:break-inside-avoid"
                >
                  {r.columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        'px-3 py-1.5 whitespace-nowrap',
                        numeric(c.type) && 'tabular text-right',
                        c.key === 'reference' && 'font-mono text-xs',
                      )}
                    >
                      {cellText(c, row[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {r.totals && (
              <tfoot className="bg-ink-tint sticky bottom-0 print:static">
                <tr className="border-ink border-t-2 font-semibold">
                  {r.columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        'px-3 py-2 whitespace-nowrap',
                        numeric(c.type) && 'tabular text-right',
                      )}
                    >
                      {cellText(c, r.totals![c.key])}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {r.notes.map((n) => (
        <p key={n} className="text-ink-2 mt-2 text-sm">
          {n}
        </p>
      ))}
    </section>
  )
}
