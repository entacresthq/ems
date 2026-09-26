import { describe, expect, it } from 'vitest'
import { normalisePhone } from '@/lib/phone'
import { isValidBvn } from '@/lib/bvn'
import { generateDb } from './generate'

const NOW = new Date('2026-09-25T15:00:00+01:00')

describe('seed data', () => {
  const db = generateDb(NOW)

  it('is deterministic', () => {
    const again = generateDb(NOW)
    expect(again.customers.map((c) => c.id)).toEqual(db.customers.map((c) => c.id))
    expect(again.transactions.length).toBe(db.transactions.length)
  })

  it('has headquarters, the five branches and 30+ staff', () => {
    expect(db.branches.map((b) => b.name)).toEqual([
      'Headquarters',
      'Egbeda',
      'Olugbede',
      'Ikotun',
      'Ipaja',
      'Igando',
    ])
    expect(db.staff.length).toBeGreaterThanOrEqual(30)
    for (const branch of db.branches.filter((b) => b.kind === 'branch')) {
      expect(
        db.staff.filter((s) => s.branchId === branch.id && s.role === 'account_officer').length,
      ).toBeGreaterThanOrEqual(4)
    }
  })

  it('seats the MD, general manager and admin at headquarters, which holds no customers', () => {
    const hq = db.branches.find((b) => b.kind === 'headquarters')!
    expect(hq.code).toBe('00')
    expect(hq.areas).toEqual([])
    const roles = db.staff.filter((s) => s.branchId === hq.id).map((s) => s.role)
    expect(roles.sort()).toEqual(['admin', 'general_manager', 'md'])
    expect(db.staff.find((s) => s.id === hq.managerId)?.role).toBe('general_manager')
    expect(db.customers.some((c) => c.branchId === hq.id)).toBe(false)
  })

  it('uses valid phone numbers, BVNs and 10-digit account numbers', () => {
    for (const c of db.customers) {
      expect(normalisePhone(c.phone)).not.toBeNull()
      if (c.bvn) expect(isValidBvn(c.bvn)).toBe(true)
    }
    const numbers = new Set(db.accounts.map((a) => a.accountNumber))
    expect(numbers.size).toBe(db.accounts.length)
    for (const a of db.accounts) expect(a.accountNumber).toMatch(/^\d{10}$/)
  })

  it('assigns every customer to an officer in the same branch', () => {
    const staffById = new Map(db.staff.map((s) => [s.id, s]))
    for (const c of db.customers) {
      const officer = staffById.get(c.officerId)
      expect(officer?.role).toBe('account_officer')
      expect(officer?.branchId).toBe(c.branchId)
    }
  })

  it('keeps balances consistent with the latest transaction', () => {
    const latest = new Map<string, number>()
    // Transactions are newest first.
    for (const t of db.transactions)
      if (!latest.has(t.accountId)) latest.set(t.accountId, t.balanceAfter)
    for (const a of db.accounts) {
      if (latest.has(a.id)) expect(a.balance).toBe(latest.get(a.id))
      expect(Number.isInteger(a.balance)).toBe(true)
      expect(a.balance).toBeGreaterThanOrEqual(0)
    }
  })

  it('keeps loan figures consistent', () => {
    for (const l of db.loans.filter((x) => x.status === 'active' || x.status === 'closed')) {
      expect(l.totalRepayable).toBe(l.principal + l.interest)
      expect(l.schedule.reduce((sum, r) => sum + r.amount, 0)).toBe(l.totalRepayable)
      expect(l.outstanding).toBe(l.totalRepayable - l.amountPaid)
      expect(l.arrears).toBeLessThanOrEqual(l.outstanding)
      if (l.arrears === 0) expect(l.daysInArrears).toBe(0)
    }
    expect(db.loans.some((l) => l.arrears > 0)).toBe(true)
    expect(db.loans.some((l) => l.status === 'closed')).toBe(true)
    // Applications at each stage, each with its approval request.
    const waiting = db.loans.filter((l) => l.status === 'pending_approval')
    expect(waiting.length).toBeGreaterThan(0)
    for (const l of waiting)
      expect(db.approvals.some((a) => a.loanId === l.id && a.status === 'pending')).toBe(true)
    expect(db.loans.some((l) => l.status === 'approved' && l.accountId === null)).toBe(true)
  })

  it('never records collections in the future', () => {
    for (const t of db.transactions)
      expect(new Date(t.createdAt).getTime()).toBeLessThanOrEqual(NOW.getTime())
  })
})
