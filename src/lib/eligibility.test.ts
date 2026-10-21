import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOAN_ELIGIBILITY,
  decodeReport,
  encodeReport,
  evaluateEligibility,
  monthlyRepaymentPerNaira,
} from './eligibility'
import { kobo, naira } from './money'
import type { EligibilityFacts, LoanEligibilityPolicy, LoanProduct } from '@/types'

const product: LoanProduct = {
  id: 'p1',
  code: '31',
  name: 'Trader loan',
  kind: 'cash',
  interestMethod: 'flat',
  interestBasis: 'monthly',
  ratePercent: '5.00',
  repaymentFrequency: 'monthly',
  minTenor: 1,
  maxTenor: 6,
  minAmount: naira(50_000),
  maxAmount: naira(1_000_000),
  processingFee: { type: 'none' },
  penalty: { type: 'percentage', percentPerDay: '0.50', graceDays: 3, capPercent: '20.00' },
  requiresGuarantor: true,
  status: 'active',
}

const facts: EligibilityFacts = {
  customerStatus: 'active',
  hasBvn: true,
  hasNextOfKin: true,
  guarantorCount: 1,
  memberDays: 400,
  savingsBalance: naira(100_000),
  depositsInWindow: 30,
  inflowInWindow: naira(180_000),
  windowDays: 90,
  writtenOffLoans: 0,
  closedLoans: 1,
  openLoan: null,
}

const policy: LoanEligibilityPolicy = { ...DEFAULT_LOAN_ELIGIBILITY }

describe('loan eligibility', () => {
  it('lends the smallest of the product limit, savings times the multiplier and what is affordable', () => {
    // 3 × ₦100,000 saved = ₦300,000.
    const savingsOnly = { ...policy, maxRepaymentPercent: null }
    expect(evaluateEligibility(savingsOnly, facts, product).maxAmount).toBe(naira(300_000))

    // By default repayments may take all of the ₦60,000 paid in a month: 60,000 / (1.3 / 6).
    const both = evaluateEligibility(policy, facts, product)
    expect(both.limitedBy).toBe('affordability')
    expect(both.maxAmount).toBe(naira(276_000))

    // ₦60,000 paid in a month; repayments within 50% = ₦30,000 a month.
    // Six monthly installments at 5% flat cost (1 + 0.3) / 6 a naira each month.
    const affordable = evaluateEligibility(
      { ...policy, savingsMultiplier: null, maxRepaymentPercent: '50.00' },
      facts,
      product,
    )
    expect(affordable.limitedBy).toBe('affordability')
    expect(affordable.maxAmount).toBe(naira(138_000)) // 30,000 / (1.3 / 6) = 138,461 → 138,000

    const noLimits = { ...policy, savingsMultiplier: null, maxRepaymentPercent: null }
    expect(evaluateEligibility(noLimits, facts, product).maxAmount).toBe(product.maxAmount)
  })

  it('works the affordable amount out for the tenor chosen', () => {
    const p = { ...policy, savingsMultiplier: null, maxRepaymentPercent: '50.00' }
    const short = evaluateEligibility(p, facts, product, { installmentCount: 2 })
    const long = evaluateEligibility(p, facts, product, { installmentCount: 6 })
    expect(short.installmentCount).toBe(2)
    expect(short.maxAmount).toBeLessThan(long.maxAmount)
  })

  it('fails the policy checks the customer does not meet', () => {
    const result = evaluateEligibility(
      { ...policy, minSavings: naira(150_000) },
      { ...facts, memberDays: 10, depositsInWindow: 1, writtenOffLoans: 1 },
      product,
    )
    expect(result.qualified).toBe(false)
    expect(result.maxAmount).toBe(0)
    const failed = result.checks.filter((c) => !c.passed).map((c) => c.key)
    expect(failed).toEqual(['membership', 'min_savings', 'regular_saving', 'write_off'])
  })

  it('does not qualify a customer whose limit is below the product minimum', () => {
    const result = evaluateEligibility(policy, { ...facts, savingsBalance: naira(10_000) }, product)
    expect(result.qualified).toBe(false)
    expect(result.checks.find((c) => c.key === 'amount')?.passed).toBe(false)
  })

  it('always requires the customer’s records, even with the policy off', () => {
    const off = { ...policy, enabled: false }
    const result = evaluateEligibility(off, { ...facts, hasBvn: false, guarantorCount: 0 }, product)
    expect(result.checks.filter((c) => !c.passed).map((c) => c.key)).toEqual(['bvn', 'guarantor'])
    expect(result.checks.every((c) => c.key === 'amount' || !c.policy)).toBe(true)
  })

  it('checks the current loan for a top-up instead of refusing an open loan', () => {
    const openLoan = {
      id: 'l1',
      loanNumber: 'LN01000001',
      status: 'active' as const,
      kind: 'cash' as const,
      totalRepayable: naira(100_000),
      amountPaid: naira(30_000),
      outstanding: naira(70_000),
      daysInArrears: 4,
    }
    const withLoan = { ...facts, openLoan }
    expect(
      evaluateEligibility(policy, withLoan, product).checks.find((c) => c.key === 'open_loan')
        ?.passed,
    ).toBe(false)

    const topUp = evaluateEligibility(policy, withLoan, product, { topUpOfId: 'l1' })
    const failed = topUp.checks.filter((c) => !c.passed).map((c) => c.key)
    expect(failed).toEqual(['top_up_arrears', 'top_up_repaid'])
  })

  it('reads an overall rate as one charge on the amount', () => {
    const overall = { ...product, interestBasis: 'overall' as const, ratePercent: '20.00' }
    expect(monthlyRepaymentPerNaira(overall, 4)).toBeCloseTo(1.2 / 4)
  })

  it('round-trips the report over the wire', () => {
    const report = {
      policy: { ...policy, minSavings: kobo(1_234_56) },
      facts,
      products: [evaluateEligibility(policy, facts, product)],
    }
    expect(decodeReport(JSON.parse(JSON.stringify(encodeReport(report))))).toEqual(report)
  })
})
