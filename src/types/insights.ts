import type { Kobo } from '@/lib/money'
import type { Role } from './auth'
import type { Id, IsoDate } from './common'

export interface ParFigures {
  portfolio: Kobo
  count: number
  par1: Kobo
  par7: Kobo
  par30: Kobo
  par1Percent: number
  par7Percent: number
  par30Percent: number
}

export interface IncomeFigures {
  interest: Kobo
  fees: Kobo
  penalties: Kobo
  commissions: Kobo
  /** Withdrawal charges from savings and target savings. */
  charges: Kobo
  total: Kobo
}

export interface OfficerRank {
  id: Id
  name: string
  branchName: string
  expected: Kobo
  collected: Kobo
  ratePercent: number
}

export interface Dashboard {
  date: IsoDate
  collections: {
    expected: Kobo
    collected: Kobo
    cash: Kobo
    transfer: Kobo
    count: number
    byGroup: { id: Id; name: string; expected: Kobo; collected: Kobo }[]
    groupedBy: 'branch' | 'officer'
    trend: { date: IsoDate; collected: Kobo }[]
  }
  cash: {
    expected: Kobo
    counted: Kobo
    variance: Kobo
    confirmed: number
    waiting: number
    notSubmitted: number
  }
  loans: ParFigures & {
    disbursedTodayCount: number
    disbursedTodayAmount: Kobo
    disbursedMonthCount: number
    disbursedMonthAmount: Kobo
    readyToPayOut: number
  }
  officers: { top: OfficerRank[]; bottom: OfficerRank[] }
  approvals: { pending: number; byType: Record<string, number> }
  counter: { deposits: Kobo; withdrawals: Kobo; repayments: Kobo; count: number }
  income: { today: IncomeFigures; month: IncomeFigures }
  staff: { active: number; suspended: number; deactivated: number; neverSignedIn: number }
  viewerRole: Role
}

export interface PeriodPerformance {
  from: IsoDate
  expected: Kobo
  collected: Kobo
  ratePercent: number
}

export interface OfficerPerformance {
  week: PeriodPerformance
  month: PeriodPerformance
  portfolio: ParFigures
  customers: number
}
