import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { auditApi } from '@/api/admin'
import { insightKeys, insightsApi } from '@/api/insights'
import { loanKeys, loansApi } from '@/api/loans'
import { StatTile, TargetBars, TrendChart } from '@/components/charts/charts'
import { ErrorState, LoadingState } from '@/components/states'
import { Money, Panel, ProgressBar } from '@/components/ui/display'
import { PageHeader } from '@/components/ui/PageHeader'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { useBranchScope } from '@/features/organisation/BranchScope'
import { cn } from '@/lib/cn'
import { formatDateTime, formatLongDate, lagosParts } from '@/lib/dates'
import { amountSizeClass, formatNaira } from '@/lib/money'
import {
  APPROVAL_TYPE_LABELS,
  ROLE_LABELS,
  type ApprovalType,
  type Dashboard,
  type OfficerRank,
} from '@/types'

function greeting() {
  const hour = lagosParts(new Date()).hour
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)

export function DashboardPage() {
  const user = useCurrentUser()
  const { branchId, branches, canSwitch } = useBranchScope()
  const scopeName = branchId
    ? (branches.find((b) => b.id === branchId)?.name ?? user.branchName)
    : 'All branches'
  const query = useQuery({
    queryKey: insightKeys.dashboard(branchId),
    queryFn: () => insightsApi.dashboard(branchId),
    refetchInterval: 60_000,
  })

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${user.firstName}`}
        description={`${formatLongDate(new Date())} · ${ROLE_LABELS[user.role]}${canSwitch || user.branchName ? ` · ${scopeName}` : ''}`}
      />
      {query.isPending ? (
        <LoadingState label="Adding up today’s figures…" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : user.role === 'accountant' ? (
        <AccountantDashboard d={query.data} />
      ) : user.role === 'cashier' ? (
        <CashierDashboard d={query.data} />
      ) : user.role === 'admin' ? (
        <AdminDashboard d={query.data} />
      ) : (
        <ManagementDashboard d={query.data} />
      )}
    </>
  )
}

function CollectionsHero({ d }: { d: Dashboard }) {
  const c = d.collections
  const text = formatNaira(c.collected, { trimZeroKobo: true })
  return (
    <section className="border-rule bg-surface rounded border p-5">
      <p className="text-ink-2 text-sm">Collected in the field today</p>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <p className={cn(amountSizeClass(text), 'tabular font-semibold')}>{text}</p>
        <p className="text-ink-2 text-sm">
          of{' '}
          <strong className="text-ink tabular">
            {formatNaira(c.expected, { trimZeroKobo: true })}
          </strong>{' '}
          expected · <strong className="text-ink tabular">{pct(c.collected, c.expected)}%</strong>
        </p>
      </div>
      <div className="mt-3">
        <ProgressBar value={c.collected} max={c.expected} label="Collected against expected" />
      </div>
      <p className="text-ink-2 mt-2 text-sm">
        {c.count} collections · <Money value={c.cash} /> cash · <Money value={c.transfer} />{' '}
        transfer
      </p>
    </section>
  )
}

function ParTiles({ d }: { d: Dashboard }) {
  const l = d.loans
  const tone = (p: number) => (p >= 10 ? 'danger' : p >= 5 ? 'warning' : undefined)
  return (
    <div className="border-rule bg-rule grid grid-cols-2 gap-px overflow-hidden rounded border lg:grid-cols-4">
      <StatTile
        label="Loan portfolio"
        value={formatNaira(l.portfolio, { trimZeroKobo: true })}
        detail={`${l.count} active loans`}
        href="/loans"
      />
      <StatTile
        label="PAR 1"
        value={`${l.par1Percent}%`}
        detail={formatNaira(l.par1, { trimZeroKobo: true })}
        tone={tone(l.par1Percent)}
        href="/loans?view=arrears"
      />
      <StatTile
        label="PAR 7"
        value={`${l.par7Percent}%`}
        detail={formatNaira(l.par7, { trimZeroKobo: true })}
        tone={tone(l.par7Percent)}
        href="/loans?view=arrears"
      />
      <StatTile
        label="PAR 30"
        value={`${l.par30Percent}%`}
        detail={formatNaira(l.par30, { trimZeroKobo: true })}
        tone={tone(l.par30Percent)}
        href="/reports/defaulters"
      />
    </div>
  )
}

function OfficerTable({ title, rows }: { title: string; rows: OfficerRank[] }) {
  return (
    <Panel title={title} flush>
      {rows.length === 0 ? (
        <p className="text-ink-2 p-4 text-sm">No collections expected today.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-rule border-b last:border-0">
                <td className="px-4 py-2">
                  {r.name}
                  <span className="text-ink-2 block text-xs">{r.branchName}</span>
                </td>
                <td className="tabular px-4 py-2 text-right">
                  <Money value={r.collected} />
                  <span className="text-ink-2 block text-xs">
                    of {formatNaira(r.expected, { trimZeroKobo: true })}
                  </span>
                </td>
                <td
                  className={cn(
                    'tabular w-16 px-4 py-2 text-right font-semibold',
                    r.ratePercent < 60 && 'text-brick',
                  )}
                >
                  {r.ratePercent}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  )
}

function ApprovalsSummary({ d }: { d: Dashboard }) {
  const entries = Object.entries(d.approvals.byType)
  // Keys arrive camelCased from the API; map back to labels.
  const label = (key: string) =>
    APPROVAL_TYPE_LABELS[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`) as ApprovalType] ?? key
  return (
    <Panel
      title="Waiting for approval"
      actions={
        <Link to="/approvals" className="text-sm font-medium underline">
          Open queue
        </Link>
      }
    >
      <p className={cn('tabular text-2xl font-semibold', d.approvals.pending > 0 && 'text-ochre')}>
        {d.approvals.pending}
      </p>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {entries.length === 0 && <li className="text-ink-2">Nothing waiting.</li>}
        {entries.map(([k, n]) => (
          <li key={k} className="flex justify-between">
            <span className="text-ink-2">{label(k)}</span>
            <span className="tabular">{n}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function ManagementDashboard({ d }: { d: Dashboard }) {
  const c = d.collections
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <CollectionsHero d={d} />
        <div className="border-rule bg-rule grid grid-cols-2 gap-px overflow-hidden rounded border">
          <StatTile
            label="Cash to count"
            value={formatNaira(d.cash.expected, { trimZeroKobo: true })}
            detail={`${d.cash.confirmed} confirmed · ${d.cash.waiting} waiting`}
            href="/remittance"
          />
          <StatTile
            label="Cash variance"
            value={formatNaira(d.cash.variance, { trimZeroKobo: true, signed: true })}
            tone={d.cash.variance < 0 ? 'danger' : undefined}
            detail="On confirmed remittances"
          />
          <StatTile
            label="Disbursed today"
            value={formatNaira(d.loans.disbursedTodayAmount, { trimZeroKobo: true })}
            detail={`${d.loans.disbursedTodayCount} loans`}
          />
          <StatTile
            label="Disbursed this month"
            value={formatNaira(d.loans.disbursedMonthAmount, { trimZeroKobo: true })}
            detail={`${d.loans.disbursedMonthCount} loans`}
          />
        </div>
      </div>
      <ParTiles d={d} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title={c.groupedBy === 'branch' ? 'By branch' : 'By officer'}>
          <TargetBars
            title={`Today, collected against expected by ${c.groupedBy}`}
            valueLabel="Collected"
            targetLabel="Expected"
            items={c.byGroup
              .filter((g) => g.expected > 0 || g.collected > 0)
              .map((g) => ({ id: g.id, label: g.name, value: g.collected, target: g.expected }))}
          />
        </Panel>
        <Panel title="Last 14 working days">
          <TrendChart
            title="Field collections per day"
            valueLabel="Collected"
            points={c.trend.map((t) => ({ date: t.date, value: t.collected }))}
          />
        </Panel>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <OfficerTable title="Top officers today" rows={d.officers.top} />
        <OfficerTable title="Officers needing support" rows={d.officers.bottom} />
        <ApprovalsSummary d={d} />
      </div>
    </div>
  )
}

function AccountantDashboard({ d }: { d: Dashboard }) {
  const i = d.income
  return (
    <div className="flex flex-col gap-6">
      <div className="border-rule bg-rule grid grid-cols-2 gap-px overflow-hidden rounded border lg:grid-cols-4">
        <StatTile
          label="Cash expected from officers"
          value={formatNaira(d.cash.expected, { trimZeroKobo: true })}
          href="/remittance"
        />
        <StatTile
          label="Counted so far"
          value={formatNaira(d.cash.counted, { trimZeroKobo: true })}
          detail={`${d.cash.confirmed} officers signed off`}
        />
        <StatTile
          label="Waiting for your count"
          value={d.cash.waiting}
          detail={`${d.cash.notSubmitted} not yet submitted`}
          tone={d.cash.waiting > 0 ? 'warning' : undefined}
          href="/remittance"
        />
        <StatTile
          label="Variance on confirmed"
          value={formatNaira(d.cash.variance, { signed: true })}
          tone={d.cash.variance < 0 ? 'danger' : undefined}
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Panel title="Last 14 working days">
          <TrendChart
            title="Field collections per day"
            valueLabel="Collected"
            points={d.collections.trend.map((t) => ({ date: t.date, value: t.collected }))}
          />
        </Panel>
        <Panel
          title="Income"
          actions={
            <Link to="/reports/income" className="text-sm font-medium underline">
              Income report
            </Link>
          }
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="text-ink-2 text-left text-xs">
                <th className="pb-2 font-semibold" />
                <th className="pb-2 text-right font-semibold">Today</th>
                <th className="pb-2 text-right font-semibold">This month</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['Loan interest', 'interest'],
                  ['Processing fees', 'fees'],
                  ['Penalties', 'penalties'],
                  ['Thrift commissions', 'commissions'],
                ] as const
              ).map(([label, k]) => (
                <tr key={k} className="border-rule border-t">
                  <td className="text-ink-2 py-1.5">{label}</td>
                  <td className="tabular py-1.5 text-right">
                    {formatNaira(i.today[k], { trimZeroKobo: true })}
                  </td>
                  <td className="tabular py-1.5 text-right">
                    {formatNaira(i.month[k], { trimZeroKobo: true })}
                  </td>
                </tr>
              ))}
              <tr className="border-ink border-t font-semibold">
                <td className="py-1.5">Total</td>
                <td className="tabular py-1.5 text-right">
                  {formatNaira(i.today.total, { trimZeroKobo: true })}
                </td>
                <td className="tabular py-1.5 text-right">
                  {formatNaira(i.month.total, { trimZeroKobo: true })}
                </td>
              </tr>
            </tbody>
          </table>
        </Panel>
      </div>
      <ApprovalsSummary d={d} />
    </div>
  )
}

function CashierDashboard({ d }: { d: Dashboard }) {
  const ready = useQuery({
    queryKey: loanKeys.list({ status: 'approved', pageSize: 10 }),
    queryFn: () => loansApi.list({ status: 'approved', pageSize: 10 }),
  })
  return (
    <div className="flex flex-col gap-6">
      <div className="border-rule bg-rule grid grid-cols-2 gap-px overflow-hidden rounded border lg:grid-cols-4">
        <StatTile
          label="Deposits today"
          value={formatNaira(d.counter.deposits, { trimZeroKobo: true })}
          href="/transactions?channel=counter&type=deposit"
        />
        <StatTile
          label="Withdrawals today"
          value={formatNaira(d.counter.withdrawals, { trimZeroKobo: true })}
          href="/transactions?channel=counter&type=withdrawal"
        />
        <StatTile
          label="Walk-in repayments"
          value={formatNaira(d.counter.repayments, { trimZeroKobo: true })}
        />
        <StatTile
          label="Loans to pay out"
          value={d.loans.readyToPayOut}
          tone={d.loans.readyToPayOut > 0 ? 'warning' : undefined}
          href="/loans?view=approved"
        />
      </div>
      <Panel
        title="Approved loans waiting to be paid out"
        flush
        actions={
          <Link to="/loans?view=approved" className="text-sm font-medium underline">
            All
          </Link>
        }
      >
        {ready.isPending ? (
          <LoadingState />
        ) : ready.data?.results.length ? (
          <ul className="divide-rule divide-y">
            {ready.data.results.map((l) => (
              <li key={l.id}>
                <Link
                  to={`/loans/${l.id}`}
                  className="hover:bg-paper flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                >
                  <span>
                    <span className="font-medium">{l.customerName}</span>
                    <span className="text-ink-2 block font-mono text-xs">{l.loanNumber}</span>
                  </span>
                  <Money value={l.principal} className="font-semibold" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-2 p-4 text-sm">
            No approved loans are waiting. They appear here once a manager approves them.
          </p>
        )}
      </Panel>
      <CollectionsHero d={d} />
    </div>
  )
}

function AdminDashboard({ d }: { d: Dashboard }) {
  const recent = useQuery({
    queryKey: ['audit', 'recent'],
    queryFn: () => auditApi.list({ pageSize: 8 }),
  })
  return (
    <div className="flex flex-col gap-6">
      <div className="border-rule bg-rule grid grid-cols-2 gap-px overflow-hidden rounded border lg:grid-cols-4">
        <StatTile label="Active staff" value={d.staff.active} href="/staff" />
        <StatTile
          label="Suspended"
          value={d.staff.suspended}
          tone={d.staff.suspended > 0 ? 'warning' : undefined}
          href="/staff?status=suspended"
        />
        <StatTile label="Deactivated" value={d.staff.deactivated} />
        <StatTile
          label="Never signed in"
          value={d.staff.neverSignedIn}
          detail="Temporary password not used yet"
        />
      </div>
      <Panel
        title="Recent activity"
        flush
        actions={
          <Link to="/audit-log" className="text-sm font-medium underline">
            Audit log
          </Link>
        }
      >
        {recent.isPending ? (
          <LoadingState />
        ) : (
          <ul className="divide-rule divide-y">
            {recent.data?.results.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 px-4 py-2.5 text-sm">
                <span>
                  <span className="font-medium">{a.actorName}</span>{' '}
                  <span className="text-ink-2">{a.summary}</span>
                </span>
                <span className="text-ink-2 text-xs">{formatDateTime(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <div className="grid gap-6 md:grid-cols-3">
        {[
          {
            to: '/settings',
            title: 'Settings',
            body: 'Business details, working days, holidays, SMS messages and limits.',
          },
          {
            to: '/staff',
            title: 'Staff',
            body: 'Add staff, change roles, suspend accounts, reset passwords.',
          },
          {
            to: '/branches',
            title: 'Branches',
            body: 'Branch details, managers and collection areas.',
          },
        ].map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className="border-rule bg-surface hover:border-ink rounded border p-4"
          >
            <p className="font-semibold">{l.title}</p>
            <p className="text-ink-2 mt-1 text-sm">{l.body}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
