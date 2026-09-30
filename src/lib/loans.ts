import { kobo, type Kobo } from './money'
import type {
  FeeRule,
  InterestBasis,
  InterestMethod,
  PenaltyRule,
  RepaymentFrequency,
} from '@/types'

/**
 * Loan arithmetic shared by the app (quotes, previews) and the mock server.
 * All amounts are integer kobo. Rates are percentages as strings ("4.00"), read
 * either per month or as one overall rate for the whole loan (see InterestBasis).
 *
 * Interest periods: a month is 26 working days, or 52/12 weeks.
 */

export const PERIODS_PER_MONTH: Record<RepaymentFrequency, number> = {
  daily: 26,
  weekly: 52 / 12,
  monthly: 1,
}

export interface Calendar {
  /** 0 = Sunday … 6 = Saturday */
  workingDays: readonly number[]
  /** YYYY-MM-DD */
  holidays: readonly string[]
}

export const DEFAULT_CALENDAR: Calendar = { workingDays: [1, 2, 3, 4, 5, 6], holidays: [] }

// ── Dates (calendar days in Lagos, as YYYY-MM-DD strings) ─────────────────

const DAY_MS = 86_400_000
const noon = (iso: string) => new Date(`${iso}T12:00:00+01:00`)
const iso = (d: Date) => {
  const shifted = new Date(d.getTime() + 60 * 60 * 1000)
  return shifted.toISOString().slice(0, 10)
}

export function addDays(date: string, days: number): string {
  return iso(new Date(noon(date).getTime() + days * DAY_MS))
}

export function daysBetween(from: string, to: string): number {
  return Math.round((noon(to).getTime() - noon(from).getTime()) / DAY_MS)
}

export function weekday(date: string): number {
  return noon(date).getUTCDay()
}

export function isOpen(date: string, cal: Calendar): boolean {
  return cal.workingDays.includes(weekday(date)) && !cal.holidays.includes(date)
}

/** The same date, or the next day the branch is open. */
export function nextOpenDay(date: string, cal: Calendar): string {
  let d = date
  for (let i = 0; i < 30 && !isOpen(d, cal); i++) d = addDays(d, 1)
  return d
}

function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const total = m - 1 + months
  const year = y + Math.floor(total / 12)
  const month = (total % 12) + 1
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`
}

/**
 * Installment due dates after `start` (the disbursement date, or the date an
 * extension begins). Daily loans fall on each open day; weekly and monthly
 * dates that land on a closed day move to the next open day.
 */
export function dueDates(
  start: string,
  frequency: RepaymentFrequency,
  count: number,
  cal: Calendar = DEFAULT_CALENDAR,
): string[] {
  const dates: string[] = []
  if (frequency === 'daily') {
    let d = start
    while (dates.length < count) {
      d = addDays(d, 1)
      if (isOpen(d, cal)) dates.push(d)
    }
    return dates
  }
  for (let k = 1; k <= count; k++) {
    const raw = frequency === 'weekly' ? addDays(start, 7 * k) : addMonths(start, k)
    dates.push(nextOpenDay(raw, cal))
  }
  return dates
}

// ── Schedules ─────────────────────────────────────────────────────────────

export interface ScheduleRow {
  number: number
  dueDate: string
  principal: Kobo
  interest: Kobo
  amount: Kobo
}

export interface LoanTerms {
  principal: Kobo
  ratePercent: string
  /** Defaults to monthly. Overall is always charged flat. */
  interestBasis?: InterestBasis
  interestMethod: InterestMethod
  frequency: RepaymentFrequency
  installmentCount: number
}

export interface Quote {
  rows: ScheduleRow[]
  interest: Kobo
  totalRepayable: Kobo
  /** The regular installment (the last one may differ by a few kobo). */
  installment: Kobo
  maturityDate: string
}

function periodRate(terms: Pick<LoanTerms, 'ratePercent' | 'frequency'>): number {
  return Number(terms.ratePercent) / 100 / PERIODS_PER_MONTH[terms.frequency]
}

/** Full repayment schedule for a new loan. */
export function buildSchedule(
  terms: LoanTerms,
  start: string,
  cal: Calendar = DEFAULT_CALENDAR,
): Quote {
  const n = terms.installmentCount
  const P = terms.principal
  const overall = terms.interestBasis === 'overall'
  const r = periodRate(terms)
  const dates = dueDates(start, terms.frequency, n, cal)
  const rows: ScheduleRow[] = []

  if (overall || terms.interestMethod === 'flat' || r === 0) {
    // An overall rate is one charge on the amount, however long the loan runs.
    const interest = overall
      ? Math.round((P * Number(terms.ratePercent)) / 100)
      : Math.round(P * r * n)
    const total = P + interest
    const installment = Math.ceil(total / n)
    let paidPrincipal = 0
    let paidInterest = 0
    for (let i = 0; i < n; i++) {
      const last = i === n - 1
      const amount = last ? total - installment * (n - 1) : installment
      const interestPart = last ? interest - paidInterest : Math.round(interest / n)
      const principalPart = last ? P - paidPrincipal : amount - interestPart
      paidInterest += interestPart
      paidPrincipal += principalPart
      rows.push({
        number: i + 1,
        dueDate: dates[i]!,
        principal: kobo(principalPart),
        interest: kobo(interestPart),
        amount: kobo(amount),
      })
    }
  } else {
    // Equal installments (annuity); interest on the reducing balance.
    const installment = Math.ceil((P * r) / (1 - (1 + r) ** -n))
    let balance: number = P
    for (let i = 0; i < n; i++) {
      const last = i === n - 1
      const interestPart = Math.round(balance * r)
      const principalPart = last ? balance : Math.min(balance, installment - interestPart)
      balance -= principalPart
      rows.push({
        number: i + 1,
        dueDate: dates[i]!,
        principal: kobo(principalPart),
        interest: kobo(interestPart),
        amount: kobo(principalPart + interestPart),
      })
    }
  }

  const interest = kobo(rows.reduce((s, r2) => s + r2.interest, 0))
  return {
    rows,
    interest,
    totalRepayable: kobo(P + interest),
    installment: rows[0]?.amount ?? kobo(0),
    maturityDate: rows[rows.length - 1]?.dueDate ?? start,
  }
}

/**
 * Spread what is still owed over new installments starting after `from`.
 * Used for extensions: no extra interest is added.
 */
export function respread(
  owed: Kobo,
  count: number,
  frequency: RepaymentFrequency,
  from: string,
  firstNumber: number,
  cal: Calendar,
): ScheduleRow[] {
  const dates = dueDates(from, frequency, count, cal)
  const each = Math.ceil(owed / count)
  return dates.map((dueDate, i) => {
    const amount = i === count - 1 ? owed - each * (count - 1) : each
    return {
      number: firstNumber + i,
      dueDate,
      principal: kobo(amount),
      interest: kobo(0),
      amount: kobo(amount),
    }
  })
}

export function processingFee(principal: Kobo, rule: FeeRule): Kobo {
  switch (rule.type) {
    case 'none':
      return kobo(0)
    case 'flat':
      return rule.amount
    case 'percentage':
      return kobo(Math.round((principal * Number(rule.percent)) / 100))
  }
}

/** One-line description of a fee rule, e.g. "2% of the amount", "₦5,000 flat", "None". */
export function describeFee(rule: FeeRule, format: (k: Kobo) => string): string {
  switch (rule.type) {
    case 'none':
      return 'None'
    case 'flat':
      return `${format(rule.amount)} flat`
    case 'percentage':
      return `${rule.percent}% of the amount`
  }
}

/** Penalty for `lateDays` days past the grace period on `arrears`. */
export function penaltyFor(rule: PenaltyRule, arrears: Kobo, lateDays: number): Kobo {
  if (arrears <= 0 || lateDays <= 0) return kobo(0)
  const perDay =
    rule.type === 'flat' ? rule.amountPerDay : (arrears * Number(rule.percentPerDay)) / 100
  const cap = (arrears * Number(rule.capPercent)) / 100
  return kobo(Math.round(Math.min(perDay * lateDays, cap)))
}

/** One-line description of a penalty rule. */
export function describePenalty(rule: PenaltyRule, format: (k: Kobo) => string): string {
  const per =
    rule.type === 'flat' ? `${format(rule.amountPerDay)} a day` : `${rule.percentPerDay}% a day`
  return `${per} after ${rule.graceDays} days, up to ${rule.capPercent}% of arrears`
}

/** One-line description of the interest terms. */
export function describeInterest(t: {
  ratePercent: string
  interestBasis: InterestBasis
  interestMethod: InterestMethod
}): string {
  if (t.interestBasis === 'overall') return `${t.ratePercent}% overall`
  return `${t.ratePercent}% a month, ${t.interestMethod === 'flat' ? 'flat' : 'reducing balance'}`
}

// ── Standing: how far along the loan is on a given day ─────────────────────

export type InstallmentStatus = 'paid' | 'part_paid' | 'overdue' | 'due_today' | 'upcoming'

export interface ScheduleRowStatus extends ScheduleRow {
  paid: Kobo
  status: InstallmentStatus
}

export interface Standing {
  rows: ScheduleRowStatus[]
  /** Unpaid installments that fell due before `today`. */
  arrears: Kobo
  daysInArrears: number
  /** Penalty under the product rule, before anything already charged. */
  penaltyDue: Kobo
  nextDue: ScheduleRowStatus | null
}

/** Allocate payments to installments in order and work out arrears as of `today`. */
export function standing(
  rows: readonly ScheduleRow[],
  amountPaid: Kobo,
  today: string,
  penalty: PenaltyRule | null,
): Standing {
  let left: number = amountPaid
  let arrears = 0
  let firstUnpaidPast: string | null = null
  const out: ScheduleRowStatus[] = rows.map((row) => {
    const paid = Math.min(row.amount, Math.max(0, left))
    left -= paid
    const unpaid = row.amount - paid
    let status: InstallmentStatus
    if (unpaid === 0) status = 'paid'
    else if (row.dueDate < today) {
      status = paid > 0 ? 'part_paid' : 'overdue'
      arrears += unpaid
      firstUnpaidPast ??= row.dueDate
    } else if (row.dueDate === today) status = paid > 0 ? 'part_paid' : 'due_today'
    else status = paid > 0 ? 'part_paid' : 'upcoming'
    return { ...row, paid: kobo(paid), status }
  })
  const daysInArrears = firstUnpaidPast ? daysBetween(firstUnpaidPast, today) : 0
  const penaltyDue = penalty
    ? penaltyFor(penalty, kobo(arrears), Math.max(0, daysInArrears - penalty.graceDays))
    : 0
  return {
    rows: out,
    arrears: kobo(arrears),
    daysInArrears,
    penaltyDue: kobo(penaltyDue),
    nextDue: out.find((r) => r.status !== 'paid' && r.dueDate >= today) ?? null,
  }
}

/** Portfolio-at-risk bucket a loan falls into. */
export function parBucket(daysInArrears: number): 0 | 1 | 7 | 30 {
  if (daysInArrears >= 30) return 30
  if (daysInArrears >= 7) return 7
  if (daysInArrears >= 1) return 1
  return 0
}
