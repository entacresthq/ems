import { beforeEach, describe, expect, it } from 'vitest'
import { isApiError, tokenStore } from '@/api/client'
import { fieldApi } from '@/api/field'
import { approvalsApi, remittancesApi } from '@/api/operations'
import { transactionsApi } from '@/api/transactions'
import { todayIso } from '@/lib/dates'
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

describe('back-office rules', () => {
  beforeEach(async () => {
    await resetMockDb()
  })

  it('lets a manager approve a reversal, which restores the balance', async () => {
    const accountant = as('accountant@ems.ng')
    const txn = db().transactions.find(
      (t) =>
        t.branchId === accountant.branchId &&
        t.type === 'thrift_contribution' &&
        t.status === 'posted',
    )!
    const account = db().accounts.find((a) => a.id === txn.accountId)!
    const before = account.balance

    const approval = await transactionsApi.requestReversal(
      txn.id,
      'Recorded twice for the same customer.',
    )
    expect(txn.status).toBe('pending_reversal')

    // The person who asked cannot approve.
    const selfApproval = await apiError(approvalsApi.approve(approval.id, ''))
    expect(selfApproval.status).toBe(403)

    as('manager@ems.ng')
    const decided = await approvalsApi.approve(approval.id, '')
    expect(decided.status).toBe('approved')
    expect(txn.status).toBe('reversed')
    expect(account.balance).toBe(before - txn.amount)
  })

  it('requires a reason to reject', async () => {
    const accountant = as('accountant@ems.ng')
    const txn = db().transactions.find(
      (t) =>
        t.branchId === accountant.branchId && t.status === 'posted' && t.type === 'loan_repayment',
    )!
    const approval = await transactionsApi.requestReversal(
      txn.id,
      'Wrong account used for this payment.',
    )
    as('manager@ems.ng')
    const err = await apiError(approvalsApi.reject(approval.id, ''))
    expect(err.fieldErrors.note).toBeDefined()
    await approvalsApi.reject(approval.id, 'Checked the card, it is correct.')
    expect(txn.status).toBe('posted')
  })

  it('sends large withdrawals for approval instead of posting them', async () => {
    const cashier = as('cashier@ems.ng')
    const account = db().accounts.find(
      (a) => a.branchId === cashier.branchId && a.type === 'savings' && a.status === 'active',
    )!
    account.balance = naira(900_000)
    const result = await transactionsApi.post({
      accountId: account.id,
      type: 'withdrawal',
      amount: naira(600_000),
      paymentMethod: 'transfer',
      narration: '',
    })
    expect(result.status).toBe('pending_approval')
    expect(account.balance).toBe(naira(900_000))

    const tooMuch = await apiError(
      transactionsApi.post({
        accountId: account.id,
        type: 'withdrawal',
        amount: naira(950_000),
        paymentMethod: 'cash',
        narration: '',
      }),
    )
    expect(tooMuch.fieldErrors.amount?.[0]).toMatch(/balance is only/)
  })

  it('needs an explanation when counted cash does not match', async () => {
    const officer = db().staff.find((s) => s.email === 'officer@ems.ng')!
    tokenStore.set(issueAccess(officer.id))
    const account = db().accounts.find(
      (a) => a.officerId === officer.id && a.type === 'thrift' && a.status === 'active',
    )!
    await fieldApi.collect({
      idempotencyKey: crypto.randomUUID(),
      accountId: account.id,
      amount: naira(2000),
      paymentMethod: 'cash',
      collectedAt: new Date().toISOString(),
      location: null,
    })
    const submitted = await remittancesApi.submit(todayIso())
    expect(submitted.status).toBe('submitted')

    as('accountant@ems.ng')
    const short = submitted.expectedCash - naira(500)
    const noNote = await apiError(
      remittancesApi.confirm({
        officerId: officer.id,
        date: todayIso(),
        cashReceived: short as typeof submitted.expectedCash,
        note: '',
      }),
    )
    expect(noNote.fieldErrors.note).toBeDefined()

    const confirmed = await remittancesApi.confirm({
      officerId: officer.id,
      date: todayIso(),
      cashReceived: short as typeof submitted.expectedCash,
      note: 'Officer says ₦500 fell out of the bag.',
    })
    expect(confirmed.status).toBe('confirmed')
    expect(confirmed.variance).toBe(-naira(500))
  })

  it('stops officers collecting from customers who are not theirs', async () => {
    const officer = as('officer@ems.ng')
    const other = db().accounts.find(
      (a) => a.officerId !== officer.id && a.type === 'thrift' && a.status === 'active',
    )!
    const err = await apiError(
      fieldApi.collect({
        idempotencyKey: crypto.randomUUID(),
        accountId: other.id,
        amount: naira(1000),
        paymentMethod: 'cash',
        collectedAt: new Date().toISOString(),
        location: null,
      }),
    )
    expect(err.fieldErrors.accountId?.[0]).toMatch(/not assigned to you/)
  })
})
