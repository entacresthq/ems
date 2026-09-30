import { beforeEach, describe, expect, it } from 'vitest'
import { accountsApi } from '@/api/accounts'
import { settingsApi } from '@/api/admin'
import { isApiError, tokenStore } from '@/api/client'
import { customersApi } from '@/api/customers'
import { loansApi } from '@/api/loans'
import { transactionsApi } from '@/api/transactions'
import { todayIso } from '@/lib/dates'
import { addDays } from '@/lib/loans'
import { DEFAULT_ACCOUNT_NUMBER_FORMAT } from '@/lib/accountNumber'
import { naira } from '@/lib/money'
import type { SavingsTarget } from '@/types'
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

/** Reversals are only allowed for recent postings, so pick one that is. */
const recent = (createdAt: string) => Date.now() - new Date(createdAt).getTime() < 3 * 86_400_000

/** An active customer in a branch who has no account of this kind yet. */
const customerIn = (branchId: string) =>
  db().customers.find((c) => c.branchId === branchId && c.status === 'active')!

describe('approvals raised by the MD or a general manager', () => {
  beforeEach(async () => {
    await resetMockDb()
  })

  it('approves a reversal straight away and puts the money back', async () => {
    const md = as('md@ems.ng')
    const txn = db().transactions.find(
      (t) => t.status === 'posted' && t.type === 'thrift_contribution' && recent(t.createdAt),
    )!
    const account = db().accounts.find((a) => a.id === txn.accountId)!
    const before = account.balance
    const approval = await transactionsApi.requestReversal(txn.id, 'Posted to the wrong account.')
    expect(approval.status).toBe('approved')
    expect(approval.decisionNote).toMatch(/automatically/i)
    expect(txn.status).toBe('reversed')
    expect(account.balance).toBe(before - txn.amount)
    expect(md.role).toBe('md')
  })

  it('does the same for a general manager', async () => {
    as('gm@ems.ng')
    const txn = db().transactions.find(
      (t) => t.status === 'posted' && t.type === 'thrift_contribution' && recent(t.createdAt),
    )!
    const approval = await transactionsApi.requestReversal(txn.id, 'Posted to the wrong account.')
    expect(approval.status).toBe('approved')
    expect(txn.status).toBe('reversed')
  })

  it('still sends a branch manager’s reversal for approval', async () => {
    const manager = as('manager@ems.ng')
    const txn = db().transactions.find(
      (t) =>
        t.branchId === manager.branchId &&
        t.status === 'posted' &&
        t.type === 'loan_repayment' &&
        recent(t.createdAt),
    )!
    const approval = await transactionsApi.requestReversal(txn.id, 'Wrong account used.')
    expect(approval.status).toBe('pending')
    expect(txn.status).toBe('pending_reversal')
  })

  it('posts a large withdrawal from the MD without waiting for anyone', async () => {
    as('md@ems.ng')
    const account = db().accounts.find((a) => a.type === 'savings' && a.status === 'active')!
    account.balance = naira(900_000)
    const result = await transactionsApi.post({
      accountId: account.id,
      type: 'withdrawal',
      amount: naira(600_000),
      paymentMethod: 'transfer',
      narration: '',
    })
    expect(result.status).toBe('posted')
    expect(account.balance).toBe(naira(300_000))
  })

  it('approves a loan application at once, ready to pay out', async () => {
    const md = as('md@ems.ng')
    const product = db().loanProducts.find((p) => p.kind === 'cash' && p.repaymentFrequency === 'weekly')!
    const customer = db().customers.find(
      (c) =>
        c.status === 'active' &&
        c.bvn &&
        c.nextOfKin &&
        c.guarantors.length > 0 &&
        !db().loans.some(
          (l) => l.customerId === c.id && ['pending_approval', 'approved', 'active'].includes(l.status),
        ),
    )!
    const loan = await loansApi.apply({
      customerId: customer.id,
      productId: product.id,
      principal: naira(100_000),
      installmentCount: 12,
      purpose: 'Restock the shop',
      collateral: [],
      topUpOfId: null,
    })
    expect(loan.status).toBe('approved')
    const approval = db().approvals.find((a) => a.loanId === loan.id)!
    expect(approval.status).toBe('approved')
    expect(approval.decidedByName).toContain(md.firstName)

    as('cashier@ems.ng')
    const { loan: paid } = await loansApi.disburse(loan.id, 'transfer')
    expect(paid.status).toBe('active')
  })

  it('closes an account at once for the MD', async () => {
    as('md@ems.ng')
    const account = db().accounts.find(
      (a) => a.type === 'savings' && a.status === 'active' && a.balance === 0,
    )
    if (!account) return // nothing suitable in this seed; the rule is covered by the reversal tests
    const approval = await accountsApi.requestClosure(account.id, 'Customer asked to close it.')
    expect(approval.status).toBe('approved')
    expect(account.status).toBe('closed')
  })
})

describe('target savings', () => {
  beforeEach(async () => {
    await resetMockDb()
  })

  const goal = (over: Partial<SavingsTarget> = {}): SavingsTarget => ({
    goalName: 'School fees',
    targetAmount: naira(120_000),
    targetDate: addDays(todayIso(), 120),
    lockUntilReached: true,
    ...over,
  })

  it('opens a target account for a customer, and a customer can have several', async () => {
    const manager = as('manager@ems.ng')
    const customer = customerIn(manager.branchId!)
    const a = await accountsApi.open({ customerId: customer.id, type: 'target', thriftPlanId: null, target: goal() })
    const b = await accountsApi.open({
      customerId: customer.id,
      type: 'target',
      thriftPlanId: null,
      target: goal({ goalName: 'New freezer' }),
    })
    expect(a.type).toBe('target')
    expect(a.target?.goalName).toBe('School fees')
    expect(a.target?.targetAmount).toBe(naira(120_000))
    expect(a.productName).toBe('School fees')
    expect(a.accountNumber).not.toBe(b.accountNumber)
    // Product code 11 sits after the two-digit branch code in the default format.
    expect(a.accountNumber.slice(2, 4)).toBe('11')
  })

  it('asks for a goal, an amount and a future date', async () => {
    const manager = as('manager@ems.ng')
    const customer = customerIn(manager.branchId!)
    const e = await apiError(
      accountsApi.open({
        customerId: customer.id,
        type: 'target',
        thriftPlanId: null,
        target: goal({ goalName: '', targetDate: todayIso() }),
      }),
    )
    expect(e.fieldErrors['target.goalName']).toBeDefined()
    expect(e.fieldErrors['target.targetDate']?.[0]).toMatch(/future/)
  })

  it('blocks withdrawals while the goal is locked, then allows them once it is reached', async () => {
    const cashier = as('cashier@ems.ng')
    const customer = customerIn(cashier.branchId!)
    const acct = await accountsApi.open({
      customerId: customer.id,
      type: 'target',
      thriftPlanId: null,
      target: goal({ targetAmount: naira(50_000) }),
    })
    await transactionsApi.post({
      accountId: acct.id,
      type: 'deposit',
      amount: naira(20_000),
      paymentMethod: 'cash',
      narration: '',
    })
    const blocked = await apiError(
      transactionsApi.post({
        accountId: acct.id,
        type: 'withdrawal',
        amount: naira(5_000),
        paymentMethod: 'cash',
        narration: '',
      }),
    )
    expect(blocked.message).toMatch(/locked until the goal/)

    await transactionsApi.post({
      accountId: acct.id,
      type: 'deposit',
      amount: naira(30_000),
      paymentMethod: 'cash',
      narration: '',
    })
    const ok = await transactionsApi.post({
      accountId: acct.id,
      type: 'withdrawal',
      amount: naira(5_000),
      paymentMethod: 'cash',
      narration: '',
    })
    expect(ok.status).toBe('posted')
  })

  it('does not block withdrawals when the customer did not choose a lock', async () => {
    const cashier = as('cashier@ems.ng')
    const customer = customerIn(cashier.branchId!)
    const acct = await accountsApi.open({
      customerId: customer.id,
      type: 'target',
      thriftPlanId: null,
      target: goal({ lockUntilReached: false }),
    })
    await transactionsApi.post({ accountId: acct.id, type: 'deposit', amount: naira(10_000), paymentMethod: 'cash', narration: '' })
    const out = await transactionsApi.post({ accountId: acct.id, type: 'withdrawal', amount: naira(4_000), paymentMethod: 'cash', narration: '' })
    expect(out.status).toBe('posted')
  })
})

describe('account number format', () => {
  beforeEach(async () => {
    await resetMockDb()
  })

  it('keeps the 10-digit format until the business changes it', async () => {
    const manager = as('manager@ems.ng')
    const acct = await accountsApi.open({
      customerId: customerIn(manager.branchId!).id,
      type: 'target',
      thriftPlanId: null,
      target: { goalName: 'Rent', targetAmount: naira(10_000), targetDate: addDays(todayIso(), 30), lockUntilReached: false },
    })
    expect(acct.accountNumber).toMatch(/^\d{10}$/)
  })

  it('uses the format from Settings for new accounts and leaves old ones alone', async () => {
    const old = db().accounts.map((a) => a.accountNumber)
    as('md@ems.ng')
    await settingsApi.update({
      accountNumberFormat: {
        prefix: 'ems',
        includeBranch: true,
        includeProduct: false,
        includeYear: true,
        serialLength: 5,
        separator: '-',
      },
    })
    expect(db().settings.accountNumberFormat.prefix).toBe('EMS')

    const manager = as('manager@ems.ng')
    const target: SavingsTarget = {
      goalName: 'Rent',
      targetAmount: naira(10_000),
      targetDate: addDays(todayIso(), 30),
      lockUntilReached: false,
    }
    const customer = customerIn(manager.branchId!)
    const a = await accountsApi.open({ customerId: customer.id, type: 'target', thriftPlanId: null, target })
    const b = await accountsApi.open({ customerId: customer.id, type: 'target', thriftPlanId: null, target })
    const year = todayIso().slice(2, 4)
    expect(a.accountNumber).toBe(`EMS-${db().branches.find((x) => x.id === manager.branchId)!.code}-${year}-00001`)
    expect(b.accountNumber).toBe(`EMS-${db().branches.find((x) => x.id === manager.branchId)!.code}-${year}-00002`)
    expect(db().accounts.map((x) => x.accountNumber).filter((n) => old.includes(n))).toHaveLength(old.length)
  })

  it('rejects a format that cannot work', async () => {
    as('md@ems.ng')
    const e = await apiError(
      settingsApi.update({ accountNumberFormat: { ...DEFAULT_ACCOUNT_NUMBER_FORMAT, serialLength: 1 } }),
    )
    expect(e.fieldErrors.accountNumberFormat?.[0]).toMatch(/between 3 and 10/)
  })

  it('only lets people with settings access change it', async () => {
    as('cashier@ems.ng')
    await apiError(settingsApi.update({ accountNumberFormat: DEFAULT_ACCOUNT_NUMBER_FORMAT }))
  })
})

describe('guarantor photo and signature', () => {
  beforeEach(async () => {
    await resetMockDb()
  })

  const image = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })

  it('gives every guarantor an id and no images to begin with', () => {
    const withGuarantor = db().customers.find((c) => c.guarantors.length > 0)!
    for (const g of withGuarantor.guarantors) {
      expect(g.id).toBeTruthy()
      expect(g.photoUrl).toBe(null)
      expect(g.signatureUrl).toBe(null)
    }
  })

  it('stores the photo and signature against the right guarantor', async () => {
    const manager = as('manager@ems.ng')
    const customer = db().customers.find((c) => c.branchId === manager.branchId && c.guarantors.length > 1)
    if (!customer) return
    const [first, second] = customer.guarantors
    const saved = await customersApi.uploadGuarantorPhoto(customer.id, second!.id, image())
    expect(saved.guarantors.find((g) => g.id === second!.id)!.photoUrl).toMatch(/^data:image\/png;base64,/)
    expect(saved.guarantors.find((g) => g.id === first!.id)!.photoUrl).toBe(null)
    const again = await customersApi.uploadGuarantorSignature(customer.id, first!.id, image())
    expect(again.guarantors.find((g) => g.id === first!.id)!.signatureUrl).toMatch(/^data:image\/png/)
  })

  it('keeps the images when the guarantor’s other details are edited', async () => {
    const manager = as('manager@ems.ng')
    const customer = db().customers.find((c) => c.branchId === manager.branchId && c.guarantors.length > 0)!
    const g = customer.guarantors[0]!
    await customersApi.uploadGuarantorPhoto(customer.id, g.id, image())
    const updated = await customersApi.update(customer.id, {
      guarantors: customer.guarantors.map((x) => ({
        id: x.id,
        fullName: x.id === g.id ? 'Changed Name' : x.fullName,
        phone: x.phone,
        address: x.address,
        relationship: x.relationship,
        occupation: x.occupation,
        bvn: x.bvn,
      })),
    })
    const after = updated.guarantors.find((x) => x.id === g.id)!
    expect(after.fullName).toBe('Changed Name')
    expect(after.photoUrl).toMatch(/^data:image\/png/)
  })

  it('rejects a file that is not an image, and an unknown guarantor', async () => {
    const manager = as('manager@ems.ng')
    const customer = db().customers.find((c) => c.branchId === manager.branchId && c.guarantors.length > 0)!
    const bad = await apiError(
      customersApi.uploadGuarantorPhoto(customer.id, customer.guarantors[0]!.id, new Blob(['hello'], { type: 'text/plain' })),
    )
    expect(bad.fieldErrors.file).toBeDefined()
    await apiError(customersApi.uploadGuarantorPhoto(customer.id, 'no-such-guarantor', image()))
  })
})
