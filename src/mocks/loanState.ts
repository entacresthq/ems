import { standing, type Calendar, type ScheduleRow } from '@/lib/loans'
import { kobo } from '@/lib/money'
import type { BusinessSettings, Loan, LoanProduct } from '@/types'

/** A loan as stored by the mock server: the public fields plus its schedule. */
export interface LoanRecord extends Loan {
  schedule: ScheduleRow[]
}

export function calendarOf(settings: Pick<BusinessSettings, 'workingDays' | 'holidays'>): Calendar {
  return { workingDays: settings.workingDays, holidays: settings.holidays.map((h) => h.date) }
}

/**
 * Recompute the derived figures (outstanding, arrears, penalty, next due)
 * from the schedule and what has been paid. Called before a loan is read.
 */
export function refreshLoan(
  loan: LoanRecord,
  product: LoanProduct | undefined,
  today: string,
): LoanRecord {
  if (loan.status !== 'active' && loan.status !== 'closed') {
    loan.outstanding = kobo(0)
    loan.arrears = kobo(0)
    loan.daysInArrears = 0
    loan.penaltyAccrued = kobo(0)
    loan.nextDueDate = loan.schedule[0]?.dueDate ?? null
    loan.nextDueAmount = loan.schedule[0]?.amount ?? null
    return loan
  }
  const owed = loan.totalRepayable + loan.penaltiesCharged
  loan.outstanding = kobo(Math.max(0, owed - loan.amountPaid))
  // Penalty payments count first, then installments in order.
  const towardsSchedule = kobo(Math.max(0, loan.amountPaid - loan.penaltiesCharged))
  const s = standing(loan.schedule, towardsSchedule, today, product?.penalty ?? null)
  loan.arrears = loan.status === 'closed' ? kobo(0) : s.arrears
  loan.daysInArrears = loan.status === 'closed' ? 0 : s.daysInArrears
  loan.penaltyAccrued = kobo(Math.max(0, s.penaltyDue - loan.penaltiesCharged))
  loan.nextDueDate = s.nextDue?.dueDate ?? null
  loan.nextDueAmount = s.nextDue ? kobo(s.nextDue.amount - s.nextDue.paid) : null
  return loan
}

export function scheduleWithStatus(
  loan: LoanRecord,
  product: LoanProduct | undefined,
  today: string,
) {
  const towardsSchedule = kobo(Math.max(0, loan.amountPaid - loan.penaltiesCharged))
  return standing(loan.schedule, towardsSchedule, today, product?.penalty ?? null).rows
}
