import { beforeEach, describe, expect, it } from 'vitest'
import { settingsApi } from '@/api/admin'
import { isApiError, tokenStore } from '@/api/client'
import { transactionsApi } from '@/api/transactions'
import { kobo, naira } from '@/lib/money'
import type { Account, Transaction } from '@/types'
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

const REASON = 'Cashier keyed the wrong figure at the counter.'

/** Entries of an account, oldest first, as the statement shows them. */
function entriesOf(account: Account): Transaction[] {
  return db()
    .transactions.map((t, i) => ({ t, i }))
    .filter(({ t }) => t.accountId === account.id)
    .sort((a, b) => a.t.createdAt.localeCompare(b.t.createdAt) || b.i - a.i)
    .map(({ t }) => t)
}

/** Every "balance after" follows from the one before, ending at the balance. */
function expectConsistent(account: Account) {
  const entries = entriesOf(account)
  for (let i = 1; i < entries.length; i++) {
    const t = entries[i]!
    const step = t.direction === 'credit' ? t.amount : -t.amount
    expect(t.balanceAfter).toBe(entries[i - 1]!.balanceAfter + step)
  }
  expect(entries.at(-1)!.balanceAfter).toBe(account.balance)
}

function savingsWithDeposits(): { account: Account; deposit: Transaction } {
  const account = db().accounts.find(
    (a) =>
      a.type === 'savings' &&
      a.status === 'active' &&
      db().transactions.filter((t) => t.accountId === a.id && t.status === 'posted').length >= 3,
  )!
  const deposit = entriesOf(account).find((t) => t.type === 'deposit' && t.status === 'posted')!
  return { account, deposit }
}

describe('editing posted transactions', () => {
  beforeEach(async () => {
    await resetMockDb()
  })

  it('is only for the MD, general managers and branch managers (in their branch)', async () => {
    const manager = db().staff.find((s) => s.email === 'manager@ems.ng')!
    const account = db().accounts.find(
      (a) =>
        a.type === 'savings' &&
        a.branchId === manager.branchId &&
        db().transactions.some(
          (t) => t.accountId === a.id && t.type === 'deposit' && t.status === 'posted',
        ),
    )!
    const deposit = db().transactions.find(
      (t) => t.accountId === account.id && t.type === 'deposit' && t.status === 'posted',
    )!
    for (const email of ['cashier@ems.ng', 'accountant@ems.ng', 'admin@ems.ng']) {
      as(email)
      const err = await apiError(
        transactionsApi.edit(deposit.id, { narration: 'Changed', reason: REASON }),
      )
      expect(err.status).toBe(403)
    }
    // A branch manager corrects their own branch's transactions, and no other branch's.
    as('manager@ems.ng')
    const byManager = await transactionsApi.edit(deposit.id, {
      narration: 'Paid in person',
      reason: REASON,
    })
    expect(byManager.narration).toBe('Paid in person')
    const elsewhere = db().transactions.find(
      (t) => t.branchId !== manager.branchId && t.type === 'deposit' && t.status === 'posted',
    )!
    const err = await apiError(
      transactionsApi.edit(elsewhere.id, { narration: 'x', reason: REASON }),
    )
    expect(err.status).toBe(404)
    as('gm@ems.ng')
    const edited = await transactionsApi.edit(deposit.id, {
      narration: 'Paid by her son',
      reason: REASON,
    })
    expect(edited.narration).toBe('Paid by her son')
    as('md@ems.ng')
    await transactionsApi.edit(deposit.id, { narration: 'Paid by her daughter', reason: REASON })
  })

  it('cannot be given to any other role', async () => {
    as('md@ems.ng')
    const s = await settingsApi.get()
    const saved = await settingsApi.update({
      rolePermissions: {
        ...s.rolePermissions,
        accountant: [...s.rolePermissions.accountant, 'transactions.edit'],
        cashier: [...s.rolePermissions.cashier, 'transactions.edit'],
      },
    })
    expect(saved.rolePermissions.accountant).not.toContain('transactions.edit')
    expect(saved.rolePermissions.cashier).not.toContain('transactions.edit')
    expect(saved.rolePermissions.branch_manager).toContain('transactions.edit')
    expect(saved.rolePermissions.general_manager).toContain('transactions.edit')
  })

  it('corrects an amount and restates every balance after it', async () => {
    as('md@ems.ng')
    const { account, deposit } = savingsWithDeposits()
    const before = account.balance
    const edited = await transactionsApi.edit(deposit.id, {
      amount: kobo(deposit.amount + naira(1_000)),
      reason: REASON,
    })
    expect(account.balance).toBe(before + naira(1_000))
    expectConsistent(account)
    expect(edited.edits).toHaveLength(1)
    expect(edited.edits![0]!.changes[0]!.field).toBe('amount')
    expect(edited.edits![0]!.reason).toBe(REASON)
    expect(
      db().audit.some((a) => a.action === 'transaction.edit' && a.entityId === deposit.id),
    ).toBe(true)
  })

  it('moves a transaction to another date and keeps the running balance right', async () => {
    as('md@ems.ng')
    const { account, deposit } = savingsWithDeposits()
    const before = account.balance
    const later = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    await transactionsApi.edit(deposit.id, { createdAt: later, reason: REASON })
    expect(account.balance).toBe(before)
    expectConsistent(account)
    expect(entriesOf(account).at(-1)!.id).toBe(deposit.id)

    const future = new Date(Date.now() + 2 * 86_400_000).toISOString()
    const err = await apiError(
      transactionsApi.edit(deposit.id, { createdAt: future, reason: REASON }),
    )
    expect(err.fieldErrors.createdAt).toBeDefined()
  })

  it('updates what a loan still owes when a repayment is corrected', async () => {
    as('md@ems.ng')
    const loan = db().loans.find((l) => l.status === 'active' && l.outstanding > naira(5_000))!
    const repayment = db().transactions.find(
      (t) => t.accountId === loan.accountId && t.type === 'loan_repayment' && t.status === 'posted',
    )!
    const owed = loan.outstanding
    await transactionsApi.edit(repayment.id, {
      amount: kobo(repayment.amount + naira(1_000)),
      reason: REASON,
    })
    expect(loan.outstanding).toBe(owed - naira(1_000))

    const tooMuch = await apiError(
      transactionsApi.edit(repayment.id, {
        amount: kobo(repayment.amount + loan.outstanding + naira(1)),
        reason: REASON,
      }),
    )
    expect(tooMuch.fieldErrors.amount?.[0]).toMatch(/left on the loan/)
  })

  it('refuses changes that would break the books', async () => {
    as('md@ems.ng')
    const { account, deposit } = savingsWithDeposits()

    // A reason is required.
    expect(
      (await apiError(transactionsApi.edit(deposit.id, { narration: 'x', reason: 'short' })))
        .fieldErrors.reason,
    ).toBeDefined()

    // Loan payouts follow the loan terms; only the date and note can change.
    const payout = db().transactions.find(
      (t) => t.type === 'disbursement' && t.status === 'posted',
    )!
    const fixed = await apiError(
      transactionsApi.edit(payout.id, { amount: kobo(payout.amount + 100), reason: REASON }),
    )
    expect(fixed.fieldErrors.amount).toBeDefined()
    await transactionsApi.edit(payout.id, {
      narration: 'Paid to her GTBank account',
      reason: REASON,
    })

    // Cutting a deposit can't leave the account short.
    // Cutting it to 1 kobo removes (amount − 1); with (amount − 2) held, that is 1 kobo short.
    account.balance = kobo(deposit.amount - 2)
    const overdraw = await apiError(
      transactionsApi.edit(deposit.id, { amount: kobo(1), reason: REASON }),
    )
    expect(overdraw.fieldErrors.amount?.[0]).toMatch(/short by/)

    // Reversed transactions stay as they are.
    const reversed = db().transactions.find((t) => t.status === 'reversed')
    if (reversed)
      expect(
        (await apiError(transactionsApi.edit(reversed.id, { narration: 'x', reason: REASON })))
          .status,
      ).toBe(400)
  })
})
