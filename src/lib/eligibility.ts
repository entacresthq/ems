import { PERIODS_PER_MONTH } from './loans'
import { formatNaira, kobo, naira, parseDecimal, toDecimal, ZERO, type Kobo } from './money'
import type {
  CustomerStatus,
  EligibilityCheck,
  EligibilityFacts,
  EligibilityReport,
  LoanEligibilityPolicy,
  LoanProduct,
  ProductEligibility,
} from '@/types'

/**
 * Loan eligibility: whether a customer qualifies for a loan product and the most
 * they can borrow, under the business's lending policy (Settings) and the
 * product's own rules. Shared by the server (which records and can enforce the
 * result) and the screens (which show it while the application is filled in).
 *
 * The amount a customer qualifies for is the smallest of:
 * - the product's largest amount;
 * - their savings times the savings multiplier;
 * - what they can afford: installments, as a monthly figure, may take at most a
 *   set percentage of what they paid in each month on average.
 */

/** How far back deposits and contributions are counted. */
export const ACTIVITY_WINDOW_DAYS = 90

/** Qualifying amounts are rounded down to this (₦1,000). */
const ROUND_TO = naira(1_000)

export const DEFAULT_LOAN_ELIGIBILITY: LoanEligibilityPolicy = {
  enabled: true,
  enforcement: 'advise',
  minMembershipDays: 30,
  minSavings: ZERO,
  savingsMultiplier: '3.00',
  savingsAccountTypes: ['savings', 'target', 'thrift'],
  minDepositsInWindow: 4,
  maxRepaymentPercent: '100.00',
  blockAfterWriteOff: true,
  topUpMaxDaysInArrears: 0,
  topUpMinRepaidPercent: '50.00',
}

export interface EvaluateOptions {
  /** Installments chosen; the product's longest tenor when not given. */
  installmentCount?: number
  /** The active loan this application would replace. */
  topUpOfId?: string | null
}

const money = (k: Kobo) => toDecimal(k)
const fmt = (k: Kobo) => formatNaira(k, { trimZeroKobo: true })

/**
 * What one naira borrowed costs each month in repayments, for this product and
 * number of installments.
 */
export function monthlyRepaymentPerNaira(
  product: Pick<
    LoanProduct,
    'ratePercent' | 'interestBasis' | 'interestMethod' | 'repaymentFrequency'
  >,
  installmentCount: number,
): number {
  const n = Math.max(1, installmentCount)
  const perMonth = PERIODS_PER_MONTH[product.repaymentFrequency]
  const rate = Number(product.ratePercent) / 100
  let perInstallment: number
  if (product.interestBasis === 'overall') perInstallment = (1 + rate) / n
  else {
    const r = rate / perMonth
    perInstallment =
      product.interestMethod === 'flat' || r === 0 ? (1 + r * n) / n : r / (1 - (1 + r) ** -n)
  }
  return perInstallment * perMonth
}

/** Average paid in each month over the activity window. */
export function monthlyInflow(facts: EligibilityFacts): Kobo {
  const days = Math.max(30, facts.windowDays)
  return kobo(Math.round((facts.inflowInWindow / days) * 30))
}

/** Most the customer can pay each month under the policy; null when there is no such limit. */
export function monthlyCapacity(
  policy: LoanEligibilityPolicy,
  facts: EligibilityFacts,
): Kobo | null {
  if (policy.maxRepaymentPercent === null) return null
  return kobo(Math.floor((monthlyInflow(facts) * Number(policy.maxRepaymentPercent)) / 100))
}

const roundDown = (k: number) => kobo(Math.max(0, Math.floor(k / ROUND_TO) * ROUND_TO))

export function evaluateEligibility(
  policy: LoanEligibilityPolicy,
  facts: EligibilityFacts,
  product: LoanProduct,
  options: EvaluateOptions = {},
): ProductEligibility {
  const tenor = Math.min(
    product.maxTenor,
    Math.max(product.minTenor, options.installmentCount ?? product.maxTenor),
  )
  const checks: EligibilityCheck[] = []
  const add = (check: EligibilityCheck) => checks.push(check)

  // ── Always required (the application is refused without these) ─────────
  add({
    key: 'active',
    label: 'Active customer',
    passed: facts.customerStatus === 'active',
    detail:
      facts.customerStatus === 'active'
        ? 'Active'
        : `Customer is ${statusText(facts.customerStatus)}`,
    policy: false,
  })
  add({
    key: 'bvn',
    label: 'BVN on record',
    passed: facts.hasBvn,
    detail: facts.hasBvn ? 'On record' : 'Add the BVN on the customer’s page',
    policy: false,
  })
  add({
    key: 'next_of_kin',
    label: 'Next of kin on record',
    passed: facts.hasNextOfKin,
    detail: facts.hasNextOfKin ? 'On record' : 'Add a next of kin on the customer’s page',
    policy: false,
  })
  if (product.requiresGuarantor)
    add({
      key: 'guarantor',
      label: 'At least one guarantor',
      passed: facts.guarantorCount > 0,
      detail: facts.guarantorCount
        ? `${facts.guarantorCount} on record`
        : 'This product needs a guarantor',
      policy: false,
    })

  const open = facts.openLoan
  const topUp = Boolean(options.topUpOfId) && open?.id === options.topUpOfId
  if (!topUp)
    add({
      key: 'open_loan',
      label: 'No other open loan',
      passed: !open,
      detail: !open
        ? 'None'
        : open.status === 'active'
          ? `Has active loan ${open.loanNumber}. Apply for a top-up of it instead.`
          : `Loan ${open.loanNumber} is waiting to be ${open.status === 'approved' ? 'paid out' : 'approved'}`,
      policy: false,
    })

  // ── The business's lending policy ───────────────────────────────────────
  const caps: ProductEligibility['limits'] = [
    { key: 'product', label: `${product.name} lends up to`, amount: product.maxAmount },
  ]
  if (policy.enabled) {
    if (policy.minMembershipDays > 0)
      add({
        key: 'membership',
        label: `Customer for at least ${policy.minMembershipDays} days`,
        passed: facts.memberDays >= policy.minMembershipDays,
        detail: `Joined ${facts.memberDays} day${facts.memberDays === 1 ? '' : 's'} ago`,
        policy: true,
      })
    if (policy.minSavings > 0)
      add({
        key: 'min_savings',
        label: `Savings of at least ${fmt(policy.minSavings)}`,
        passed: facts.savingsBalance >= policy.minSavings,
        detail: `Has ${fmt(facts.savingsBalance)} saved`,
        policy: true,
      })
    if (policy.minDepositsInWindow > 0)
      add({
        key: 'regular_saving',
        label: `At least ${policy.minDepositsInWindow} deposits or contributions in the last ${ACTIVITY_WINDOW_DAYS} days`,
        passed: facts.depositsInWindow >= policy.minDepositsInWindow,
        detail: `${facts.depositsInWindow} in the last ${ACTIVITY_WINDOW_DAYS} days`,
        policy: true,
      })
    if (policy.blockAfterWriteOff)
      add({
        key: 'write_off',
        label: 'No loan written off',
        passed: facts.writtenOffLoans === 0,
        detail: facts.writtenOffLoans
          ? `${facts.writtenOffLoans} loan${facts.writtenOffLoans > 1 ? 's' : ''} written off`
          : 'None',
        policy: true,
      })
    if (topUp && open) {
      add({
        key: 'top_up_arrears',
        label:
          policy.topUpMaxDaysInArrears === 0
            ? 'Current loan is not in arrears'
            : `Current loan at most ${policy.topUpMaxDaysInArrears} days in arrears`,
        passed: open.daysInArrears <= policy.topUpMaxDaysInArrears,
        detail: open.daysInArrears ? `${open.daysInArrears} days in arrears` : 'Up to date',
        policy: true,
      })
      const repaid =
        open.totalRepayable > 0 ? Math.floor((open.amountPaid / open.totalRepayable) * 100) : 0
      if (Number(policy.topUpMinRepaidPercent) > 0)
        add({
          key: 'top_up_repaid',
          label: `At least ${Number(policy.topUpMinRepaidPercent)}% of the current loan repaid`,
          passed: repaid >= Number(policy.topUpMinRepaidPercent),
          detail: `${repaid}% repaid`,
          policy: true,
        })
    }

    if (policy.savingsMultiplier !== null)
      caps.push({
        key: 'savings',
        label: `${Number(policy.savingsMultiplier)} × savings of ${fmt(facts.savingsBalance)}`,
        amount: roundDown(facts.savingsBalance * Number(policy.savingsMultiplier)),
      })
    const capacity = monthlyCapacity(policy, facts)
    if (capacity !== null)
      caps.push({
        key: 'affordability',
        label: `Repayments within ${Number(policy.maxRepaymentPercent)}% of ${fmt(monthlyInflow(facts))} paid in a month, over ${tenor} installments`,
        amount: roundDown(capacity / monthlyRepaymentPerNaira(product, tenor)),
      })
  }

  const ceiling = caps.reduce((min, c) => (c.amount < min.amount ? c : min))
  const maxAmount = ceiling.amount
  const amountOk = maxAmount >= product.minAmount
  add({
    key: 'amount',
    label: `Qualifies for at least ${fmt(product.minAmount)}, the product’s smallest amount`,
    passed: amountOk,
    detail: amountOk
      ? `Can borrow up to ${fmt(maxAmount)}`
      : `Qualifies for only ${fmt(maxAmount)}`,
    policy: true,
  })

  const qualified = checks.every((c) => c.passed)
  return {
    productId: product.id,
    productName: product.name,
    installmentCount: tenor,
    qualified,
    maxAmount: qualified ? maxAmount : ZERO,
    limitedBy: ceiling.key,
    limits: caps,
    checks,
  }
}

function statusText(status: CustomerStatus) {
  return status === 'pending_approval' ? 'waiting for approval' : status
}

/** The checks that failed, as short sentences for the approver. */
export function failedChecks(result: ProductEligibility): string[] {
  return result.checks.filter((c) => !c.passed).map((c) => `${c.label}: ${c.detail}`)
}

// ── On the wire: money as decimal strings, like every other amount ──────────

type WirePolicy = Omit<LoanEligibilityPolicy, 'minSavings'> & { minSavings: string }

export const encodePolicy = (p: LoanEligibilityPolicy): WirePolicy => ({
  ...p,
  minSavings: money(p.minSavings),
})

export const decodePolicy = (p: WirePolicy | undefined): LoanEligibilityPolicy =>
  p ? { ...p, minSavings: parseDecimal(p.minSavings) } : DEFAULT_LOAN_ELIGIBILITY

type WireFacts = Omit<EligibilityFacts, 'savingsBalance' | 'inflowInWindow' | 'openLoan'> & {
  savingsBalance: string
  inflowInWindow: string
  openLoan:
    | (Omit<
        NonNullable<EligibilityFacts['openLoan']>,
        'totalRepayable' | 'amountPaid' | 'outstanding'
      > & {
        totalRepayable: string
        amountPaid: string
        outstanding: string
      })
    | null
}

type WireResult = Omit<ProductEligibility, 'maxAmount' | 'limits'> & {
  maxAmount: string
  limits: (Omit<ProductEligibility['limits'][number], 'amount'> & { amount: string })[]
}

export interface WireEligibilityReport {
  policy: WirePolicy
  facts: WireFacts
  products: WireResult[]
}

export const encodeReport = (r: EligibilityReport): WireEligibilityReport => ({
  policy: encodePolicy(r.policy),
  facts: {
    ...r.facts,
    savingsBalance: money(r.facts.savingsBalance),
    inflowInWindow: money(r.facts.inflowInWindow),
    openLoan: r.facts.openLoan && {
      ...r.facts.openLoan,
      totalRepayable: money(r.facts.openLoan.totalRepayable),
      amountPaid: money(r.facts.openLoan.amountPaid),
      outstanding: money(r.facts.openLoan.outstanding),
    },
  },
  products: r.products.map((p) => ({
    ...p,
    maxAmount: money(p.maxAmount),
    limits: p.limits.map((l) => ({ ...l, amount: money(l.amount) })),
  })),
})

export const decodeReport = (w: WireEligibilityReport): EligibilityReport => ({
  policy: decodePolicy(w.policy),
  facts: {
    ...w.facts,
    savingsBalance: parseDecimal(w.facts.savingsBalance),
    inflowInWindow: parseDecimal(w.facts.inflowInWindow),
    openLoan: w.facts.openLoan && {
      ...w.facts.openLoan,
      totalRepayable: parseDecimal(w.facts.openLoan.totalRepayable),
      amountPaid: parseDecimal(w.facts.openLoan.amountPaid),
      outstanding: parseDecimal(w.facts.openLoan.outstanding),
    },
  },
  products: w.products.map((p) => ({
    ...p,
    maxAmount: parseDecimal(p.maxAmount),
    limits: p.limits.map((l) => ({ ...l, amount: parseDecimal(l.amount) })),
  })),
})
