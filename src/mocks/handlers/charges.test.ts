import { beforeEach, describe, expect, it } from 'vitest'
import { settingsApi } from '@/api/admin'
import { isApiError, tokenStore } from '@/api/client'
import { approvalsApi } from '@/api/operations'
import { transactionsApi } from '@/api/transactions'
import { chargeFor } from '@/lib/charges'
import { todayIso } from '@/lib/dates'
import { kobo, naira } from '@/lib/money'
import type { Account } from '@/types'
import { incomeFor } from '../analytics'
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

/** A savings account in the cashier's branch with money in it. */
function savingsIn(branchId: string | null, balance = naira(200_000)): Account {
  const account = db().accounts.find(
    (a) => a.branchId === branchId && a.type === 'savings' && a.status === 'active',
  )!
  account.balance = balance
  return account
}

const withdraw = (account: Account, amount: ReturnType<typeof naira>) =>
  transactionsApi.post({
    accountId: account.id,
    type: 'withdrawal',
    amount,
    paymentMethod: 'cash',
    narration: '',
  })

describe('withdrawal charges', () => {
  beforeEach(async () => {
    await resetMockDb()
    as('md@ems.ng')
    await settingsApi.update({
      transactionCharges: {
        savingsWithdrawal: { type: 'percentage', percent: '1', cap: naira(500) },
        targetWithdrawal: { type: 'flat', amount: naira(100) },
      },
    })
  })

  it('works out percentages, caps and flat fees', () => {
    const percent = { type: 'percentage', percent: '1.5', cap: null } as const
    expect(chargeFor(naira(10_000), percent)).toBe(naira(150))
    expect(chargeFor(naira(10_000), { ...percent, cap: naira(100) })).toBe(naira(100))
    expect(chargeFor(naira(10_000), { type: 'flat', amount: naira(50) })).toBe(naira(50))
    expect(chargeFor(naira(10_000), { type: 'none' })).toBe(0)
    expect(chargeFor(kobo(333), percent)).toBe(kobo(5)) // rounded to the nearest kobo
  })

  it('keeps the charges in Settings', async () => {
    const saved = await settingsApi.get()
    expect(saved.transactionCharges.savingsWithdrawal).toEqual({
      type: 'percentage',
      percent: '1.00',
      cap: naira(500),
    })
    expect(saved.transactionCharges.targetWithdrawal).toEqual({ type: 'flat', amount: naira(100) })
    const bad = await apiError(
      settingsApi.update({
        transactionCharges: {
          ...saved.transactionCharges,
          savingsWithdrawal: { type: 'percentage', percent: '50', cap: null },
        },
      }),
    )
    expect(bad.fieldErrors['transactionCharges.savingsWithdrawal']).toBeDefined()
  })

  it('takes a percentage charge from savings, up to the cap', async () => {
    const cashier = as('cashier@ems.ng')
    const account = savingsIn(cashier.branchId)

    const small = await withdraw(account, naira(10_000))
    if (small.status !== 'posted') throw new Error('expected posted')
    expect(small.charge?.amount).toBe(naira(100))
    expect(small.charge?.type).toBe('withdrawal_charge')
    expect(account.balance).toBe(naira(200_000 - 10_000 - 100))

    const big = await withdraw(account, naira(100_000))
    if (big.status !== 'posted') throw new Error('expected posted')
    expect(big.charge?.amount).toBe(naira(500))
  })

  it('takes the flat fee from target savings', async () => {
    const cashier = as('cashier@ems.ng')
    const account = savingsIn(cashier.branchId, naira(50_000))
    Object.assign(account, {
      type: 'target',
      target: {
        goalName: 'School fees',
        targetAmount: naira(40_000),
        targetDate: todayIso(),
        lockUntilReached: false,
      },
    })
    const result = await withdraw(account, naira(5_000))
    if (result.status !== 'posted') throw new Error('expected posted')
    expect(result.charge?.amount).toBe(naira(100))
    expect(account.balance).toBe(naira(50_000 - 5_000 - 100))
  })

  it('needs the balance to cover the withdrawal and its charge', async () => {
    const cashier = as('cashier@ems.ng')
    const account = savingsIn(cashier.branchId, naira(10_000))
    const err = await apiError(withdraw(account, naira(10_000)))
    expect(err.fieldErrors.amount?.[0]).toMatch(/charge need/)
    expect(account.balance).toBe(naira(10_000))
  })

  it('counts charges as income and refunds them with a reversed withdrawal', async () => {
    const cashier = as('cashier@ems.ng')
    const account = savingsIn(cashier.branchId)
    const before = incomeFor({ branchId: cashier.branchId }, todayIso(), todayIso())
    const result = await withdraw(account, naira(20_000))
    if (result.status !== 'posted') throw new Error('expected posted')
    const after = incomeFor({ branchId: cashier.branchId }, todayIso(), todayIso())
    expect(after.charges - before.charges).toBe(naira(200))
    expect(after.total - before.total).toBe(naira(200))

    const approval = await transactionsApi.requestReversal(
      result.transaction.id,
      'Customer changed their mind at the counter.',
    )
    as('manager@ems.ng')
    await approvalsApi.approve(approval.id, '')
    expect(account.balance).toBe(naira(200_000))
    const charge = db().transactions.find((t) => t.id === result.charge!.id)!
    expect(charge.status).toBe('reversed')
  })

  it('charges nothing when Settings say so', async () => {
    as('md@ems.ng')
    await settingsApi.update({
      transactionCharges: {
        savingsWithdrawal: { type: 'none' },
        targetWithdrawal: { type: 'none' },
      },
    })
    const cashier = as('cashier@ems.ng')
    const account = savingsIn(cashier.branchId)
    const result = await withdraw(account, naira(10_000))
    if (result.status !== 'posted') throw new Error('expected posted')
    expect(result.charge).toBe(null)
    expect(account.balance).toBe(naira(190_000))
  })
})
