import { todayIso } from '@/lib/dates'
import {
  ACTIVITY_WINDOW_DAYS,
  DEFAULT_LOAN_ELIGIBILITY,
  evaluateEligibility,
} from '@/lib/eligibility'
import { addDays, daysBetween } from '@/lib/loans'
import { kobo } from '@/lib/money'
import type { Customer, EligibilityFacts, EligibilityReport, LoanEligibilityPolicy } from '@/types'
import { db } from './db'
import { current, lagosDay } from './domain'

const OPEN_STATUSES = ['active', 'approved', 'pending_approval']

export const eligibilityPolicy = (): LoanEligibilityPolicy =>
  db().settings.loanEligibility ?? DEFAULT_LOAN_ELIGIBILITY

/** What the records say about the customer, as of today. */
export function eligibilityFacts(
  customer: Customer,
  policy: LoanEligibilityPolicy = eligibilityPolicy(),
  today: string = todayIso(),
): EligibilityFacts {
  const memberDays = Math.max(0, daysBetween(lagosDay(customer.createdAt), today))
  const windowDays = Math.min(ACTIVITY_WINDOW_DAYS, memberDays)
  const from = addDays(today, -windowDays)

  const counted = new Set<string>(policy.savingsAccountTypes)
  const savingsBalance = db()
    .accounts.filter(
      (a) => a.customerId === customer.id && a.status !== 'closed' && counted.has(a.type),
    )
    .reduce((sum, a) => sum + Math.max(0, a.balance), 0)

  let depositsInWindow = 0
  let inflowInWindow = 0
  for (const t of db().transactions) {
    if (
      t.customerId === customer.id &&
      t.status === 'posted' &&
      t.direction === 'credit' &&
      (t.type === 'deposit' || t.type === 'thrift_contribution') &&
      lagosDay(t.createdAt) >= from
    ) {
      depositsInWindow++
      inflowInWindow += t.amount
    }
  }

  const loans = db().loans.filter((l) => l.customerId === customer.id)
  const open = loans.find((l) => OPEN_STATUSES.includes(l.status))
  const openLoan = open ? current(open) : null

  return {
    customerStatus: customer.status,
    hasBvn: Boolean(customer.bvn),
    hasNextOfKin: Boolean(customer.nextOfKin),
    guarantorCount: customer.guarantors.length,
    memberDays,
    savingsBalance: kobo(savingsBalance),
    depositsInWindow,
    inflowInWindow: kobo(inflowInWindow),
    windowDays,
    writtenOffLoans: loans.filter((l) => l.status === 'written_off').length,
    closedLoans: loans.filter((l) => l.status === 'closed').length,
    openLoan: openLoan && {
      id: openLoan.id,
      loanNumber: openLoan.loanNumber,
      status: openLoan.status,
      kind: openLoan.kind,
      totalRepayable: openLoan.totalRepayable,
      amountPaid: openLoan.amountPaid,
      outstanding: openLoan.outstanding,
      daysInArrears: openLoan.daysInArrears,
    },
  }
}

/** Whether the customer qualifies for each active product, at its longest tenor. */
export function eligibilityReport(
  customer: Customer,
  topUpOfId?: string | null,
): EligibilityReport {
  const policy = eligibilityPolicy()
  const facts = eligibilityFacts(customer, policy)
  const products = db()
    .loanProducts.filter((p) => p.status === 'active' && (!topUpOfId || p.kind === 'cash'))
    .map((p) => evaluateEligibility(policy, facts, p, { topUpOfId }))
  return { policy, facts, products }
}
