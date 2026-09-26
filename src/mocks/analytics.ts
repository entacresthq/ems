import { addDays, isOpen, parBucket } from '@/lib/loans'
import { formatDate, todayIso } from '@/lib/dates'
import { kobo, toDecimal, type Kobo } from '@/lib/money'
import type { Account, Transaction } from '@/types'
import { db } from './db'
import {
  calendar,
  current,
  isCollection,
  lagosDay,
  remittanceRow,
  staffName,
  todayItems,
} from './domain'
import type { LoanRecord } from './loanState'
import type { StaffRecord } from './seed/generate'

/**
 * Figures behind dashboards and reports. The real backend would run these as
 * database aggregates; the shapes are what the API returns.
 */

export interface Scope {
  /** null = every branch the caller may see */
  branchId: string | null
  officerId?: string | null
}

const sum = (items: readonly number[]) => kobo(items.reduce((n, v) => n + v, 0))
const inBranch = (s: Scope) => (row: { branchId: string }) =>
  !s.branchId || row.branchId === s.branchId
const inPeriod = (from: string, to: string) => (t: { createdAt: string }) => {
  const d = lagosDay(t.createdAt)
  return d >= from && d <= to
}

export function openDaysBetween(from: string, to: string): string[] {
  const cal = calendar()
  const days: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) if (isOpen(d, cal)) days.push(d)
  return days
}

export function officersIn(scope: Scope): StaffRecord[] {
  return db().staff.filter(
    (s) =>
      s.role === 'account_officer' &&
      (!scope.branchId || s.branchId === scope.branchId) &&
      (!scope.officerId || s.id === scope.officerId),
  )
}

// ── Collections ───────────────────────────────────────────────────────────

export function expectedFor(officers: StaffRecord[], day: string): Kobo {
  return sum(
    officers.flatMap((o) => todayItems(o, day).flatMap((i) => i.dues.map((d) => d.amountDue))),
  )
}

export function collectionsFor(scope: Scope, from: string, to: string): Transaction[] {
  return db().transactions.filter(
    (t) =>
      isCollection(t) &&
      inBranch(scope)(t) &&
      (!scope.officerId || t.officerId === scope.officerId) &&
      inPeriod(from, to)(t),
  )
}

// ── Portfolio at risk ─────────────────────────────────────────────────────

export function activeLoans(scope: Scope): LoanRecord[] {
  return db()
    .loans.filter(
      (l) =>
        l.status === 'active' &&
        inBranch(scope)(l) &&
        (!scope.officerId || l.officerId === scope.officerId),
    )
    .map(current)
}

export interface Par {
  portfolio: string
  count: number
  par1: string
  par7: string
  par30: string
  par1Percent: number
  par7Percent: number
  par30Percent: number
}

/** PAR n = outstanding balance of loans at least n days late, as a share of the whole portfolio. */
export function par(loans: LoanRecord[]): Par {
  const portfolio = sum(loans.map((l) => l.outstanding))
  const atRisk = (n: 1 | 7 | 30) =>
    sum(loans.filter((l) => parBucket(l.daysInArrears) >= n).map((l) => l.outstanding))
  const pct = (v: number) => (portfolio > 0 ? Math.round((v / portfolio) * 1000) / 10 : 0)
  const [p1, p7, p30] = [atRisk(1), atRisk(7), atRisk(30)]
  return {
    portfolio: toDecimal(portfolio),
    count: loans.length,
    par1: toDecimal(p1),
    par7: toDecimal(p7),
    par30: toDecimal(p30),
    par1Percent: pct(p1),
    par7Percent: pct(p7),
    par30Percent: pct(p30),
  }
}

// ── Income ────────────────────────────────────────────────────────────────

export interface Income {
  interest: Kobo
  fees: Kobo
  penalties: Kobo
  commissions: Kobo
  total: Kobo
}

/**
 * Income for a period. Interest is recognised as each repayment comes in,
 * in proportion to the loan's interest share of the total repayable.
 */
export function incomeFor(scope: Scope, from: string, to: string): Income {
  const txns = db().transactions.filter(
    (t) => t.status !== 'reversed' && inBranch(scope)(t) && inPeriod(from, to)(t),
  )
  const loanByAccount = new Map(
    db()
      .loans.filter((l) => l.accountId)
      .map((l) => [l.accountId!, l]),
  )
  const interest = sum(
    txns
      .filter((t) => t.type === 'loan_repayment')
      .map((t) => {
        const loan = loanByAccount.get(t.accountId)
        return loan && loan.totalRepayable > 0
          ? Math.round((t.amount * loan.interest) / loan.totalRepayable)
          : 0
      }),
  )
  const of = (type: Transaction['type']) =>
    sum(txns.filter((t) => t.type === type).map((t) => t.amount))
  const fees = of('processing_fee')
  const penalties = of('penalty')
  const commissions = of('thrift_commission')
  return {
    interest,
    fees,
    penalties,
    commissions,
    total: kobo(interest + fees + penalties + commissions),
  }
}

export const incomeJson = (i: Income) => ({
  interest: toDecimal(i.interest),
  fees: toDecimal(i.fees),
  penalties: toDecimal(i.penalties),
  commissions: toDecimal(i.commissions),
  total: toDecimal(i.total),
})

// ── Dashboard ─────────────────────────────────────────────────────────────

export function dashboard(scope: Scope, viewer: StaffRecord) {
  const today = todayIso()
  const monthStart = `${today.slice(0, 8)}01`
  const officers = officersIn(scope).filter(
    (o) =>
      o.status === 'active' ||
      collectionsFor({ branchId: null, officerId: o.id }, today, today).length > 0,
  )
  const todays = collectionsFor(scope, today, today)
  // Each officer's dues are worked out once and reused below.
  const expectedByOfficer = new Map(officers.map((o) => [o.id, expectedFor([o], today)]))
  const expectedOf = (list: StaffRecord[]) => sum(list.map((o) => expectedByOfficer.get(o.id) ?? 0))
  const expected = expectedOf(officers)
  const collected = sum(todays.map((t) => t.amount))

  // Per branch (all-branch view) or per officer (single branch).
  const groups = scope.branchId
    ? officers.map((o) => ({ id: o.id, name: staffName(o), officers: [o] }))
    : db()
        .branches.filter((b) => b.kind === 'branch')
        .map((b) => ({
          id: b.id,
          name: b.name,
          officers: officers.filter((o) => o.branchId === b.id),
        }))
  const byGroup = groups.map((g) => {
    const ids = new Set(g.officers.map((o) => o.id))
    return {
      id: g.id,
      name: g.name,
      expected: toDecimal(expectedOf(g.officers)),
      collected: toDecimal(
        sum(todays.filter((t) => t.officerId && ids.has(t.officerId)).map((t) => t.amount)),
      ),
    }
  })

  // Last 14 open days of field collections.
  const days = openDaysBetween(addDays(today, -21), today).slice(-14)
  const trend = days.map((d) => ({
    date: d,
    collected: toDecimal(sum(collectionsFor(scope, d, d).map((t) => t.amount))),
  }))

  // Officer ranking by today's collection rate.
  const ranking = officers
    .map((o) => {
      const exp = expectedByOfficer.get(o.id) ?? kobo(0)
      const got = sum(todays.filter((t) => t.officerId === o.id).map((t) => t.amount))
      return {
        id: o.id,
        name: staffName(o),
        branchName: o.branchName ?? '',
        expected: exp,
        collected: got,
        rate: exp > 0 ? got / exp : 0,
      }
    })
    .filter((r) => r.expected > 0)
    .sort((a, b) => b.rate - a.rate || b.collected - a.collected)
  const rankJson = (r: (typeof ranking)[number]) => ({
    id: r.id,
    name: r.name,
    branchName: r.branchName,
    expected: toDecimal(r.expected),
    collected: toDecimal(r.collected),
    ratePercent: Math.round(r.rate * 1000) / 10,
  })

  // Cash and remittance.
  const rows = officers.map((o) => remittanceRow(o, today))
  const cashExpected = sum(rows.map((r) => r.expectedCash))
  const cashCounted = sum(rows.map((r) => r.cashReceived ?? 0))
  const variance = sum(rows.filter((r) => r.variance !== null).map((r) => r.variance!))

  // Loans.
  const allLoans = db().loans.filter(inBranch(scope))
  const disbursedBetween = (from: string, to: string) =>
    allLoans.filter(
      (l) => l.disbursedAt && lagosDay(l.disbursedAt) >= from && lagosDay(l.disbursedAt) <= to,
    )
  const disbursedToday = disbursedBetween(today, today)
  const disbursedMonth = disbursedBetween(monthStart, today)

  // Counter activity.
  const counter = db().transactions.filter(
    (t) =>
      t.channel === 'counter' &&
      t.status !== 'reversed' &&
      inBranch(scope)(t) &&
      lagosDay(t.createdAt) === today,
  )
  const counterSum = (type: Transaction['type']) =>
    toDecimal(sum(counter.filter((t) => t.type === type).map((t) => t.amount)))

  const pendingApprovals = db().approvals.filter(
    (a) => a.status === 'pending' && inBranch(scope)(a),
  )
  const staffInScope = db().staff.filter((s) => !scope.branchId || s.branchId === scope.branchId)

  return {
    date: today,
    collections: {
      expected: toDecimal(expected),
      collected: toDecimal(collected),
      cash: toDecimal(sum(todays.filter((t) => t.paymentMethod === 'cash').map((t) => t.amount))),
      transfer: toDecimal(
        sum(todays.filter((t) => t.paymentMethod === 'transfer').map((t) => t.amount)),
      ),
      count: todays.length,
      byGroup,
      groupedBy: scope.branchId ? 'officer' : 'branch',
      trend,
    },
    cash: {
      expected: toDecimal(cashExpected),
      counted: toDecimal(cashCounted),
      variance: toDecimal(variance),
      confirmed: rows.filter((r) => r.status === 'confirmed').length,
      waiting: rows.filter((r) => r.status === 'submitted').length,
      notSubmitted: rows.filter((r) => r.status === 'not_submitted' && r.collectionsCount > 0)
        .length,
    },
    loans: {
      disbursedTodayCount: disbursedToday.length,
      disbursedTodayAmount: toDecimal(sum(disbursedToday.map((l) => l.principal))),
      disbursedMonthCount: disbursedMonth.length,
      disbursedMonthAmount: toDecimal(sum(disbursedMonth.map((l) => l.principal))),
      readyToPayOut: allLoans.filter((l) => l.status === 'approved').length,
      ...par(activeLoans(scope)),
    },
    officers: {
      top: ranking.slice(0, 5).map(rankJson),
      bottom: ranking.slice(-5).reverse().map(rankJson),
    },
    approvals: {
      pending: pendingApprovals.length,
      byType: Object.fromEntries(
        [...new Set(pendingApprovals.map((a) => a.type))].map((t) => [
          t,
          pendingApprovals.filter((a) => a.type === t).length,
        ]),
      ),
    },
    counter: {
      deposits: counterSum('deposit'),
      withdrawals: counterSum('withdrawal'),
      repayments: counterSum('loan_repayment'),
      count: counter.length,
    },
    income: {
      today: incomeJson(incomeFor(scope, today, today)),
      month: incomeJson(incomeFor(scope, monthStart, today)),
    },
    staff: {
      active: staffInScope.filter((s) => s.status === 'active').length,
      suspended: staffInScope.filter((s) => s.status === 'suspended').length,
      deactivated: staffInScope.filter((s) => s.status === 'deactivated').length,
      neverSignedIn: staffInScope.filter((s) => !s.lastLoginAt).length,
    },
    viewerRole: viewer.role,
  }
}

// ── Officer performance (field app) ───────────────────────────────────────

export function officerPerformance(officer: StaffRecord) {
  const today = todayIso()
  const weekday = new Date(`${today}T12:00:00+01:00`).getUTCDay()
  const weekStart = addDays(today, -((weekday + 6) % 7)) // Monday
  const monthStart = `${today.slice(0, 8)}01`
  const period = (from: string) => {
    const expected = sum(openDaysBetween(from, today).map((d) => expectedFor([officer], d)))
    const collected = sum(
      collectionsFor({ branchId: null, officerId: officer.id }, from, today).map((t) => t.amount),
    )
    return {
      from,
      expected: toDecimal(expected),
      collected: toDecimal(collected),
      ratePercent: expected > 0 ? Math.round((collected / expected) * 1000) / 10 : 0,
    }
  }
  return {
    week: period(weekStart),
    month: period(monthStart),
    portfolio: par(activeLoans({ branchId: null, officerId: officer.id })),
    customers: db().customers.filter((c) => c.officerId === officer.id && c.status === 'active')
      .length,
  }
}

// ── Helpers for reports ───────────────────────────────────────────────────

export const dateLabel = (iso: string | null) => (iso ? formatDate(iso) : '')
export type { Account }
