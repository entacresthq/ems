import { beforeEach, describe, expect, it } from 'vitest'
import { isApiError, tokenStore } from '@/api/client'
import { approvalsApi } from '@/api/operations'
import { transactionsApi } from '@/api/transactions'
import { transfersApi } from '@/api/transfers'
import { kobo, naira } from '@/lib/money'
import type { Account } from '@/types'
import { db, resetMockDb } from '../db'
import { thriftCycle } from '../domain'
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

const active = (a: Account) => a.status === 'active'

function savingsIn(branchId: string | null, exceptCustomer?: string): Account {
  const account = db().accounts.find(
    (a) =>
      a.branchId === branchId &&
      a.type === 'savings' &&
      active(a) &&
      a.customerId !== exceptCustomer,
  )!
  account.balance = naira(300_000)
  return account
}

describe('transfers', () => {
  beforeEach(async () => {
    await resetMockDb()
  })

  it('moves money between two customers and records both sides', async () => {
    const cashier = as('cashier@ems.ng')
    const from = savingsIn(cashier.branchId)
    // Any branch can receive.
    const to = db().accounts.find(
      (a) =>
        a.type === 'savings' &&
        active(a) &&
        a.customerId !== from.customerId &&
        a.branchId !== cashier.branchId,
    )!
    const toBefore = to.balance

    const enquiry = await transfersApi.nameEnquiry(to.accountNumber)
    expect(enquiry.customerName).toBe(to.customerName)

    const result = await transfersApi.create({
      fromAccountId: from.id,
      toAccountId: to.id,
      amount: naira(25_000),
      narration: 'Rent for October',
    })
    if (result.status !== 'posted') throw new Error('expected posted')
    expect(from.balance).toBe(naira(275_000))
    expect(to.balance).toBe(toBefore + naira(25_000))
    expect(result.debit.type).toBe('transfer_out')
    expect(result.credit.type).toBe('transfer_in')
    expect(result.debit.transferId).toBeTruthy()
    expect(result.debit.transferId).toBe(result.credit.transferId)
    expect(result.debit.narration).toContain(to.accountNumber)
    expect(db().audit.some((a) => a.action === 'transfer.post')).toBe(true)
  })

  it('pays a loan from the same customer’s savings as a repayment', async () => {
    const cashier = as('cashier@ems.ng')
    const loan = db().loans.find(
      (l) =>
        l.status === 'active' &&
        l.branchId === cashier.branchId &&
        l.outstanding > naira(5_000) &&
        db().accounts.some(
          (a) => a.customerId === l.customerId && a.type === 'savings' && active(a),
        ),
    )!
    const savings = db().accounts.find(
      (a) => a.customerId === loan.customerId && a.type === 'savings' && active(a),
    )!
    savings.balance = naira(100_000)
    const owed = loan.outstanding
    const result = await transfersApi.create({
      fromAccountId: savings.id,
      toAccountId: loan.accountId!,
      amount: naira(5_000),
      narration: '',
    })
    if (result.status !== 'posted') throw new Error('expected posted')
    expect(result.credit.type).toBe('loan_repayment')
    expect(loan.outstanding).toBe(owed - naira(5_000))

    // More than the loan still owes (with enough in savings to cover it).
    savings.balance = kobo(loan.outstanding + naira(10_000))
    const tooMuch = await apiError(
      transfersApi.create({
        fromAccountId: savings.id,
        toAccountId: loan.accountId!,
        amount: kobo(loan.outstanding + naira(1)),
        narration: '',
      }),
    )
    expect(tooMuch.fieldErrors.amount).toBeDefined()
  })

  it('refuses what can’t work', async () => {
    const cashier = as('cashier@ems.ng')
    const from = savingsIn(cashier.branchId)
    const to = savingsIn(cashier.branchId, from.customerId)
    const same = await apiError(
      transfersApi.create({
        fromAccountId: from.id,
        toAccountId: from.id,
        amount: naira(10),
        narration: '',
      }),
    )
    expect(same.fieldErrors.toAccountId).toBeDefined()
    const short = await apiError(
      transfersApi.create({
        fromAccountId: from.id,
        toAccountId: to.id,
        amount: naira(300_001),
        narration: '',
      }),
    )
    expect(short.fieldErrors.amount).toBeDefined()
    to.status = 'frozen'
    const frozen = await apiError(
      transfersApi.create({
        fromAccountId: from.id,
        toAccountId: to.id,
        amount: naira(10),
        narration: '',
      }),
    )
    expect(frozen.fieldErrors.toAccountId?.[0]).toMatch(/frozen/)
  })

  it('reverses both sides together', async () => {
    const cashier = as('cashier@ems.ng')
    const from = savingsIn(cashier.branchId)
    const to = savingsIn(cashier.branchId, from.customerId)
    to.balance = naira(1_000)
    const result = await transfersApi.create({
      fromAccountId: from.id,
      toAccountId: to.id,
      amount: naira(10_000),
      narration: '',
    })
    if (result.status !== 'posted') throw new Error('expected posted')
    const approval = await transactionsApi.requestReversal(
      result.credit.id,
      'Sent to the wrong customer by mistake.',
    )
    as('manager@ems.ng')
    await approvalsApi.approve(approval.id, '')
    expect(from.balance).toBe(naira(300_000))
    expect(to.balance).toBe(naira(1_000))
    const legs = db().transactions.filter((t) => t.transferId === result.debit.transferId)
    expect(legs.every((t) => t.status === 'reversed')).toBe(true)
  })

  it('sends large transfers for approval first', async () => {
    const cashier = as('cashier@ems.ng')
    const from = savingsIn(cashier.branchId)
    from.balance = naira(2_000_000)
    const to = savingsIn(cashier.branchId, from.customerId)
    const toBefore = to.balance
    const pending = await transfersApi.create({
      fromAccountId: from.id,
      toAccountId: to.id,
      amount: naira(600_000),
      narration: 'Shop purchase',
    })
    expect(pending.status).toBe('pending_approval')
    expect(to.balance).toBe(toBefore)
    if (pending.status !== 'pending_approval') return
    as('manager@ems.ng')
    await approvalsApi.approve(pending.approval.id, '')
    expect(to.balance).toBe(toBefore + naira(600_000))
    expect(from.balance).toBe(naira(1_400_000))
  })
})

describe('thrift withdrawals', () => {
  beforeEach(async () => {
    await resetMockDb()
  })

  /** A thrift account in the cashier's branch partway through its cycle. */
  function thriftMidCycle(branchId: string | null): Account {
    const account = db().accounts.find(
      (a) =>
        a.branchId === branchId &&
        a.type === 'thrift' &&
        active(a) &&
        a.balance > naira(2_000) &&
        thriftCycle(a).paid >= 2 &&
        !thriftCycle(a).complete,
    )!
    return account
  }

  it('respects the plan’s early-withdrawal rule', async () => {
    const cashier = as('cashier@ems.ng')
    const account = thriftMidCycle(cashier.branchId)
    const plan = db().thriftPlans.find((p) => p.id === account.productId)!
    plan.earlyWithdrawalAllowed = false
    const post = () =>
      transactionsApi.post({
        accountId: account.id,
        type: 'withdrawal',
        amount: naira(1_000),
        paymentMethod: 'cash',
        narration: '',
      })
    const refused = await apiError(post())
    expect(refused.message).toMatch(/doesn’t allow withdrawals before the cycle ends/)

    plan.earlyWithdrawalAllowed = true
    const allowed = await post()
    if (allowed.status !== 'posted') throw new Error('expected posted')
    expect(allowed.transaction.type).toBe('withdrawal')
  })

  it('pays out a completed cycle and starts the next', async () => {
    const cashier = as('cashier@ems.ng')
    const account = thriftMidCycle(cashier.branchId)
    const plan = db().thriftPlans.find((p) => p.id === account.productId)!
    plan.earlyWithdrawalAllowed = false
    plan.cycleLength = thriftCycle(account).paid // the cycle is now complete
    const result = await transactionsApi.post({
      accountId: account.id,
      type: 'withdrawal',
      amount: account.balance,
      paymentMethod: 'transfer',
      narration: '',
    })
    if (result.status !== 'posted') throw new Error('expected posted')
    expect(result.transaction.type).toBe('thrift_payout')
    expect(account.balance).toBe(0)
    expect(thriftCycle(account).paid).toBe(0)
  })
})
