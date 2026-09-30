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

/** Cash loan: money paid to the customer. BNPL: the company buys an item for the customer. */
export type LoanKind = 'cash' | 'bnpl'

/**
 * How the interest rate is read.
 * - monthly: the rate applies for every month the loan runs.
 * - overall: one rate for the whole loan, however long it runs (always flat).
 */
export type InterestBasis = 'monthly' | 'overall'

export type FeeRule =
  | { type: 'none' }
  | { type: 'percentage'; percent: string }
  | { type: 'flat'; amount: Kobo }

export type PenaltyRule = {
  graceDays: number
  /** Penalty stops growing once it reaches this percent of the arrears. */
  capPercent: string
} & (
  | {
      type: 'percentage'
      /** Percent of the overdue amount charged per day late. */
      percentPerDay: string
    }
  | {
      type: 'flat'
      /** A fixed amount charged for every day late. */
      amountPerDay: Kobo
    }
)

export interface LoanProduct {
  id: Id
  code: string
  name: string
  kind: LoanKind
  interestMethod: InterestMethod
  interestBasis: InterestBasis
  /** Interest rate as a decimal string, e.g. "4.00". Read according to interestBasis. */
  ratePercent: string
  repaymentFrequency: RepaymentFrequency
  minTenor: number
  maxTenor: number
  /** Loan amount for cash loans; item price for BNPL. */
  minAmount: Kobo
  maxAmount: Kobo
  processingFee: FeeRule
  penalty: PenaltyRule
  requiresGuarantor: boolean
  status: 'active' | 'retired'
}

/** The code is assigned by the server. */
export type ThriftPlanInput = Omit<ThriftPlan, 'id' | 'code'>
