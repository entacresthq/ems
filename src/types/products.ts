import type { Kobo } from '@/lib/money'
import type { Id } from './common'

export type ThriftFrequency = 'daily' | 'weekly'

export type CommissionRule =
  /** Collector keeps one contribution per cycle (common "ajo" practice). */
  | { type: 'first_contribution' }
  | { type: 'percentage'; percent: string }
  | { type: 'flat'; amount: Kobo }

export interface ThriftPlan {
  id: Id
  /** Two digits used inside account numbers. */
  code: string
  name: string
  frequency: ThriftFrequency
  contributionAmount: Kobo
  /** Number of contributions in one cycle (e.g. 31 days). */
  cycleLength: number
  commission: CommissionRule
  /** Contributions a customer may miss before payout is delayed. */
  allowedMisses: number
  earlyWithdrawalAllowed: boolean
  status: 'active' | 'retired'
}

export type RepaymentFrequency = 'daily' | 'weekly' | 'monthly'
export type InterestMethod = 'flat' | 'reducing_balance'

export interface PenaltyRule {
  /** Percent of the overdue installment charged per day late. */
  percentPerDay: string
  graceDays: number
  /** Penalty stops growing once it reaches this percent of the installment. */
  capPercent: string
}

export interface LoanProduct {
  id: Id
  code: string
  name: string
  interestMethod: InterestMethod
  /** Monthly interest rate as a decimal string, e.g. "4.00". */
  monthlyRatePercent: string
  repaymentFrequency: RepaymentFrequency
  minTenor: number
  maxTenor: number
  minAmount: Kobo
  maxAmount: Kobo
  processingFeePercent: string
  penalty: PenaltyRule
  requiresGuarantor: boolean
  status: 'active' | 'retired'
}

/** The code is assigned by the server. */
export type ThriftPlanInput = Omit<ThriftPlan, 'id' | 'code'>
