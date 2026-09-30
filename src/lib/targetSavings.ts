import { kobo, type Kobo } from './money'
import type { SavingsTarget } from '@/types'

const DAY = 86_400_000

/** Whole days from one calendar date to another (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY)
}

export interface GoalProgress {
  /** 0 to 100, one decimal place. */
  percent: number
  saved: Kobo
  remaining: Kobo
  daysLeft: number
  reached: boolean
  /** The target date has passed without the goal being reached. */
  overdue: boolean
  /** Withdrawals are blocked right now. */
  locked: boolean
  /** How much to put aside to get there, by the target date. Null once reached or overdue. */
  perDay: Kobo | null
  perWeek: Kobo | null
  perMonth: Kobo | null
}

export function goalProgress(target: SavingsTarget, balance: Kobo, today: string): GoalProgress {
  const saved = kobo(Math.max(0, balance))
  const remaining = kobo(Math.max(0, target.targetAmount - saved))
  const reached = saved >= target.targetAmount
  const daysLeft = daysBetween(today, target.targetDate)
  const overdue = !reached && daysLeft < 0
  const percent = Math.min(100, Math.round((saved / target.targetAmount) * 1000) / 10)
  const locked = target.lockUntilReached && !reached && daysLeft > 0
  const open = !reached && daysLeft > 0
  const per = (days: number) => (open ? kobo(Math.ceil(remaining / Math.max(1, Math.ceil(daysLeft / days)))) : null)
  return {
    percent,
    saved,
    remaining,
    daysLeft,
    reached,
    overdue,
    locked,
    perDay: per(1),
    perWeek: per(7),
    perMonth: per(30),
  }
}
