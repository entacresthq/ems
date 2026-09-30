import { beforeEach, describe, expect, it } from 'vitest'
import { isApiError, tokenStore } from '@/api/client'
import { loanProductsApi, loansApi, type LoanProductInput } from '@/api/loans'
import { approvalsApi } from '@/api/operations'
import { transactionsApi } from '@/api/transactions'
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

function eligibleCustomer(branchId: string) {
  return db().customers.find(
    (c) =>
      c.branchId === branchId &&
      c.status === 'active' &&
      c.bvn &&
      c.nextOfKin &&
      c.guarantors.length > 0 &&
      !db().loans.some(
        (l) =>
          l.customerId === c.id && ['active', 'approved', 'pending_approval'].includes(l.status),
      ),
  )!
}

describe('loan lifecycle', () => {
  beforeEach(async () => {
    await resetMockDb()
  })

  it('applies, approves, pays out, collects and extends', { timeout: 20_000 }, async () => {
    const manager = as('manager@ems.ng')
    const customer = eligibleCustomer(manager.branchId!)
    const product = db().loanProducts.find(
      (p) => p.kind === 'cash' && p.repaymentFrequency === 'weekly',
    )!

    const loan = await loansApi.apply({
      customerId: customer.id,
      productId: product.id,
      principal: naira(200_000),
      installmentCount: 12,
      purpose: 'Restock shop goods',
      collateral: [],
      topUpOfId: null,
    })
    expect(loan.status).toBe('pending_approval')
    const approval = db().approvals.find((a) => a.loanId === loan.id)!

    // The applicant can't approve their own loan.
    expect((await apiError(approvalsApi.approve(approval.id, ''))).status).toBe(403)

    as('md@ems.ng')
    await approvalsApi.approve(approval.id, '')
    expect((await loansApi.get(loan.id)).status).toBe('approved')

    as('cashier@ems.ng')
    const { loan: paid, payout } = await loansApi.disburse(loan.id, 'transfer')
    expect(paid.status).toBe('active')
    expect(paid.accountNumber).toMatch(/^\d{10}$/)
    // 2.5% processing fee is taken from the payout.
    expect(payout).toBe(naira(200_000) - naira(5_000))
    expect(paid.outstanding).toBe(paid.totalRepayable)

    const detail = await loansApi.get(loan.id)
    expect(detail.schedule).toHaveLength(12)
    expect(detail.schedule.every((r) => r.status === 'upcoming')).toBe(true)

    // A walk-in repayment reduces what is owed.
    await transactionsApi.post({
      accountId: paid.accountId!,
      type: 'loan_repayment',
      amount: paid.installmentAmount,
      paymentMethod: 'cash',
      narration: '',
    })
    const afterPayment = await loansApi.get(loan.id)
    expect(afterPayment.outstanding).toBe(paid.totalRepayable - paid.installmentAmount)
    expect(afterPayment.schedule[0]!.status).toBe('paid')

    // Extension: two more installments, same total.
    as('manager@ems.ng')
    const ext = await loansApi.requestExtension(
      loan.id,
      2,
      'Customer’s shop was flooded last week.',
    )
    as('md@ems.ng')
    await approvalsApi.approve(ext.id, '')
    const extended = await loansApi.get(loan.id)
    expect(extended.schedule).toHaveLength(14)
    expect(extended.extensions).toBe(1)
    expect(extended.schedule.reduce((s, r) => s + r.amount, 0)).toBe(paid.totalRepayable)
  })

  it('enforces lending rules', async () => {
    const manager = as('manager@ems.ng')
    const product = db().loanProducts.find(
      (p) => p.kind === 'cash' && p.repaymentFrequency === 'daily',
    )!
    const borrower = db().loans.find(
      (l) => l.status === 'active' && l.branchId === manager.branchId,
    )!
    const customer = db().customers.find((c) => c.id === borrower.customerId)!

    const tooBig = await apiError(
      loansApi.apply({
        customerId: customer.id,
        productId: product.id,
        principal: naira(5_000_000),
        installmentCount: 30,
        purpose: 'Expand the stall',
        collateral: [],
        topUpOfId: null,
      }),
    )
    expect(tooBig.fieldErrors.principal?.[0]).toMatch(/lends between/)
    // One active loan at a time; a top-up is the way to borrow more.
    expect(tooBig.fieldErrors.customerId?.[0]).toMatch(/top-up/)
  })
})

const productInput = (over: Partial<LoanProductInput> = {}): LoanProductInput => ({
  name: 'Test product',
  kind: 'cash',
  interestMethod: 'flat',
  interestBasis: 'monthly',
  ratePercent: '4.00',
  repaymentFrequency: 'weekly',
  minTenor: 4,
  maxTenor: 12,
  minAmount: naira(10_000),
  maxAmount: naira(500_000),
  processingFee: { type: 'percentage', percent: '2.00' },
  penalty: { type: 'percentage', percentPerDay: '1.00', graceDays: 2, capPercent: '20.00' },
  requiresGuarantor: false,
  status: 'active',
  ...over,
})

describe('loan product options', () => {
  beforeEach(async () => {
    await resetMockDb()
    as('md@ems.ng')
  })

  it('offers both cash and buy now pay later products', async () => {
    const { results } = await loanProductsApi.list()
    expect(results.some((p) => p.kind === 'cash')).toBe(true)
    expect(results.some((p) => p.kind === 'bnpl')).toBe(true)
  })

  it('saves an overall rate, a flat fee and a flat daily penalty', async () => {
    const saved = await loanProductsApi.create(
      productInput({
        kind: 'bnpl',
        interestBasis: 'overall',
        ratePercent: '12.00',
        processingFee: { type: 'flat', amount: naira(1_500) },
        penalty: { type: 'flat', amountPerDay: naira(100), graceDays: 1, capPercent: '10.00' },
      }),
    )
    expect(saved.kind).toBe('bnpl')
    expect(saved.interestBasis).toBe('overall')
    expect(saved.processingFee).toEqual({ type: 'flat', amount: naira(1_500) })
    expect(saved.penalty).toMatchObject({ type: 'flat', amountPerDay: naira(100) })
  })

  it('allows no processing fee', async () => {
    const saved = await loanProductsApi.create(productInput({ processingFee: { type: 'none' } }))
    expect(saved.processingFee).toEqual({ type: 'none' })
  })

  it('always stores an overall rate as flat', async () => {
    const saved = await loanProductsApi.create(
      productInput({ interestBasis: 'overall', interestMethod: 'reducing_balance' }),
    )
    expect(saved.interestMethod).toBe('flat')
  })

  it('rejects a flat fee with no amount', async () => {
    const e = await apiError(
      loanProductsApi.create(productInput({ processingFee: { type: 'flat', amount: 0 as never } })),
    )
    expect(e.fieldErrors['processingFee.amount']?.[0]).toMatch(/amount/)
  })
})

describe('buy now pay later', () => {
  beforeEach(async () => {
    await resetMockDb()
  })

  it('buys the item, collects the fee at handover and schedules repayments', async () => {
    const manager = as('manager@ems.ng')
    const customer = eligibleCustomer(manager.branchId!)
    const product = db().loanProducts.find((p) => p.kind === 'bnpl')!

    // The item and supplier are required.
    const missing = await apiError(
      loansApi.apply({
        customerId: customer.id,
        productId: product.id,
        principal: naira(100_000),
        installmentCount: 8,
        purpose: '',
        collateral: [],
        topUpOfId: null,
      }),
    )
    expect(missing.fieldErrors.itemDescription).toBeDefined()
    expect(missing.fieldErrors.supplierName).toBeDefined()

    const loan = await loansApi.apply({
      customerId: customer.id,
      productId: product.id,
      principal: naira(100_000),
      installmentCount: 8,
      purpose: '',
      itemDescription: '43-inch television',
      supplierName: 'Ikeja Electronics',
      collateral: [],
      topUpOfId: null,
    })
    expect(loan.kind).toBe('bnpl')
    expect(loan.itemDescription).toBe('43-inch television')
    // 15% overall on ₦100,000, and the ₦2,000 flat fee.
    expect(loan.interest).toBe(naira(15_000))
    expect(loan.processingFee).toBe(naira(2_000))

    as('md@ems.ng')
    await approvalsApi.approve(db().approvals.find((a) => a.loanId === loan.id)!.id, '')

    as('cashier@ems.ng')
    const { loan: paid, payout } = await loansApi.disburse(loan.id, 'transfer')
    // The supplier gets the full price; the fee is not taken out of it.
    expect(payout).toBe(naira(100_000))
    expect(paid.status).toBe('active')
    expect(paid.totalRepayable).toBe(naira(115_000))
    expect((await loansApi.get(loan.id)).schedule).toHaveLength(8)
  })

  it('does not allow a top-up', async () => {
    const manager = as('manager@ems.ng')
    const bnpl = db().loanProducts.find((p) => p.kind === 'bnpl')!
    const active = db().loans.find((l) => l.status === 'active' && l.branchId === manager.branchId)!
    const e = await apiError(
      loansApi.apply({
        customerId: active.customerId,
        productId: bnpl.id,
        principal: naira(100_000),
        installmentCount: 8,
        purpose: '',
        itemDescription: 'Generator',
        supplierName: 'Power Hub',
        collateral: [],
        topUpOfId: active.id,
      }),
    )
    expect(e.fieldErrors.topUpOfId?.[0]).toMatch(/cash loans/)
  })
})
