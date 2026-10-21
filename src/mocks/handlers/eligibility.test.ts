import { beforeEach, describe, expect, it } from 'vitest'
import { settingsApi } from '@/api/admin'
import { isApiError, tokenStore } from '@/api/client'
import { loansApi } from '@/api/loans'
import { naira } from '@/lib/money'
import { db, resetMockDb } from '../db'
import { issueAccess } from '../utils'

const as = (email: string) => {
  const staff = db().staff.find((s) => s.email === email)!
  tokenStore.set(issueAccess(staff.id))
  return staff
}

async function apiError(promise: Promise<unknown>) {
  try {
    await promise
  } catch (e) {
    if (isApiError(e)) return e
  }
  throw new Error('Expected the request to fail')
}

/** A customer with their records complete. Any open loan is closed, so they can apply. */
function customerWithoutLoan(branchId: string) {
  const customer = db().customers.find(
    (c) =>
      c.branchId === branchId &&
      c.status === 'active' &&
      c.bvn &&
      c.nextOfKin &&
      c.guarantors.length > 0 &&
      db().accounts.some((a) => a.customerId === c.id && a.type !== 'loan' && a.balance > 0),
  )!
  for (const l of db().loans)
    if (
      l.customerId === customer.id &&
      ['active', 'approved', 'pending_approval'].includes(l.status)
    )
      l.status = 'closed'
  return customer
}

const cashProduct = () => db().loanProducts.find((p) => p.kind === 'cash' && p.status === 'active')!

describe('loan eligibility', () => {
  beforeEach(async () => {
    await resetMockDb()
  })

  it('reports what the customer qualifies for on each active product', async () => {
    const manager = as('manager@ems.ng')
    const customer = customerWithoutLoan(manager.branchId!)
    const report = await loansApi.eligibility(customer.id)

    const active = db().loanProducts.filter((p) => p.status === 'active')
    expect(report.products.map((p) => p.productId).sort()).toEqual(active.map((p) => p.id).sort())
    for (const p of report.products) {
      const product = active.find((x) => x.id === p.productId)!
      if (p.qualified) {
        expect(p.maxAmount).toBeGreaterThanOrEqual(product.minAmount)
        expect(p.maxAmount).toBeLessThanOrEqual(product.maxAmount)
      } else expect(p.maxAmount).toBe(0)
    }
    expect(report.facts.savingsBalance).toBe(
      db()
        .accounts.filter(
          (a) => a.customerId === customer.id && a.type !== 'loan' && a.status !== 'closed',
        )
        .reduce((s, a) => s + Math.max(0, a.balance), 0),
    )
  })

  it('records the result on the application and flags it for the approver', async () => {
    const manager = as('manager@ems.ng')
    const customer = customerWithoutLoan(manager.branchId!)
    const product = cashProduct()
    // Savings decide the amount: 0.01 × savings is far below any product minimum.
    db().settings.loanEligibility = {
      ...db().settings.loanEligibility,
      savingsMultiplier: '0.01',
      maxRepaymentPercent: null,
    }
    const loan = await loansApi.apply({
      customerId: customer.id,
      productId: product.id,
      principal: product.minAmount,
      installmentCount: product.minTenor,
      purpose: 'Restock shop goods',
      collateral: [],
      topUpOfId: null,
    })
    expect(loan.eligibility?.qualified).toBe(false)
    expect(loan.eligibility?.enforced).toBe(false)
    expect(loan.eligibility?.failed.join(' ')).toMatch(/smallest amount/)
    const approval = db().approvals.find((a) => a.loanId === loan.id)!
    expect(approval.subject).toMatch(/outside the lending policy/)
  })

  it('refuses applications that fail when the business enforces the policy', async () => {
    as('md@ems.ng')
    await settingsApi.update({
      loanEligibility: {
        ...db().settings.loanEligibility,
        enforcement: 'block',
        savingsMultiplier: null,
        maxRepaymentPercent: null,
        minDepositsInWindow: 0,
        minMembershipDays: 0,
        minSavings: naira(100_000_000),
      },
    })
    expect(db().settings.loanEligibility.enforcement).toBe('block')

    const manager = as('manager@ems.ng')
    const customer = customerWithoutLoan(manager.branchId!)
    const product = cashProduct()
    const err = await apiError(
      loansApi.apply({
        customerId: customer.id,
        productId: product.id,
        principal: product.minAmount,
        installmentCount: product.minTenor,
        purpose: 'Restock shop goods',
        collateral: [],
        topUpOfId: null,
      }),
    )
    expect(err.fieldErrors.customerId?.join(' ')).toMatch(/Lending policy: Savings of at least/)
    expect(
      db().loans.some((l) => l.customerId === customer.id && l.status === 'pending_approval'),
    ).toBe(false)
  })

  it('refuses more than the customer qualifies for when enforced', async () => {
    const manager = as('manager@ems.ng')
    const product = cashProduct()
    const customer = customerWithoutLoan(manager.branchId!)
    const { facts } = await loansApi.eligibility(customer.id)
    expect(facts.savingsBalance).toBeGreaterThan(0)
    // Lend about twice the product minimum, from savings alone.
    const multiplier = (
      Math.ceil(((2 * product.minAmount) / facts.savingsBalance) * 100) / 100
    ).toFixed(2)
    as('md@ems.ng')
    await settingsApi.update({
      loanEligibility: {
        ...db().settings.loanEligibility,
        enforcement: 'block',
        minDepositsInWindow: 0,
        minMembershipDays: 0,
        minSavings: naira(0),
        savingsMultiplier: multiplier,
        maxRepaymentPercent: null,
      },
    })
    as('manager@ems.ng')
    const result = (await loansApi.eligibility(customer.id)).products.find(
      (p) => p.productId === product.id,
    )!
    expect(result.qualified).toBe(true)
    expect(result.limitedBy).toBe('savings')
    expect(result.maxAmount).toBeLessThan(product.maxAmount)

    const apply = (principal: number) =>
      loansApi.apply({
        customerId: customer.id,
        productId: product.id,
        principal: principal as typeof product.minAmount,
        installmentCount: product.minTenor,
        purpose: 'Restock shop goods',
        collateral: [],
        topUpOfId: null,
      })
    const err = await apiError(apply(result.maxAmount + naira(1_000)))
    expect(err.fieldErrors.principal?.join(' ')).toMatch(/qualifies for up to/)

    const loan = await apply(result.maxAmount)
    expect(loan.eligibility).toMatchObject({ qualified: true, enforced: true, failed: [] })
  })

  it('checks the settings it is given', async () => {
    as('md@ems.ng')
    const err = await apiError(
      settingsApi.update({
        loanEligibility: {
          ...db().settings.loanEligibility,
          savingsAccountTypes: [],
          minMembershipDays: -1,
        },
      }),
    )
    expect(Object.keys(err.fieldErrors)).toEqual(
      expect.arrayContaining([
        'loanEligibility.savingsAccountTypes',
        'loanEligibility.minMembershipDays',
      ]),
    )
  })
})
