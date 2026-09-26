import { beforeEach, describe, expect, it } from 'vitest'
import { tokenStore } from '@/api/client'
import { insightsApi } from '@/api/insights'
import { todayIso } from '@/lib/dates'
import { addDays } from '@/lib/loans'
import { parseDecimal } from '@/lib/money'
import { REPORTS } from '@/lib/reportCatalogue'
import { db, resetMockDb } from '../db'
import { issueAccess } from '../utils'

const as = (email: string) => {
  const staff = db().staff.find((s) => s.email === email)!
  tokenStore.set(issueAccess(staff.id))
  return staff
}

describe('dashboards and reports', () => {
  beforeEach(async () => {
    await resetMockDb()
  })

  it('gives the MD a figure for every section', { timeout: 30_000 }, async () => {
    as('md@ems.ng')
    const d = await insightsApi.dashboard(null)
    expect(d.collections.byGroup).toHaveLength(5)
    expect(d.collections.trend.length).toBeGreaterThan(5)
    expect(d.loans.count).toBeGreaterThan(0)
    expect(d.loans.par30Percent).toBeLessThanOrEqual(d.loans.par7Percent)
    expect(d.loans.par7Percent).toBeLessThanOrEqual(d.loans.par1Percent)
    expect(typeof d.loans.portfolio).toBe('number')
  })

  it('keeps a branch manager to their own branch', async () => {
    const manager = as('manager@ems.ng')
    const d = await insightsApi.dashboard(null)
    expect(d.collections.groupedBy).toBe('officer')
    const officers = db().staff.filter(
      (s) => s.branchId === manager.branchId && s.role === 'account_officer',
    )
    expect(d.collections.byGroup.every((g) => officers.some((o) => o.id === g.id))).toBe(true)
  })

  it('runs every report with well-formed money', { timeout: 30_000 }, async () => {
    as('md@ems.ng')
    const from = addDays(todayIso(), -30)
    const account = db().accounts.find((a) => a.type === 'savings' && a.status === 'active')!
    for (const def of REPORTS) {
      const r = await insightsApi.report(def.key, {
        dateFrom: from,
        dateTo: todayIso(),
        accountNumber: def.key === 'statement' ? account.accountNumber : undefined,
        minDays: 7,
      })
      expect(r.title).toBe(def.title)
      expect(r.columns.length).toBeGreaterThan(1)
      for (const c of r.columns.filter((c) => c.type === 'money')) {
        for (const row of r.rows) {
          const v = row[c.key]
          if (v !== null && v !== undefined && v !== '')
            expect(() => parseDecimal(String(v))).not.toThrow()
        }
      }
    }
  })

  it('makes the statement closing balance match the account', async () => {
    as('md@ems.ng')
    const account = db().accounts.find(
      (a) => a.type === 'thrift' && a.status === 'active' && a.balance > 0,
    )!
    const r = await insightsApi.report('statement', {
      dateFrom: addDays(todayIso(), -60),
      dateTo: todayIso(),
      accountNumber: account.accountNumber,
    })
    expect(parseDecimal(String(r.totals!.balance))).toBe(account.balance)
  })

  it('shows an officer their own performance', async () => {
    as('officer@ems.ng')
    const p = await insightsApi.performance()
    expect(p.month.expected).toBeGreaterThan(0)
    expect(p.customers).toBeGreaterThan(0)
  })
})
