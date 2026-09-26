import { beforeEach, describe, expect, it } from 'vitest'
import { isApiError, tokenStore } from '@/api/client'
import { loansApi } from '@/api/loans'
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
    const product = db().loanProducts.find((p) => p.repaymentFrequency === 'weekly')!

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
    const product = db().loanProducts.find((p) => p.repaymentFrequency === 'daily')!
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
