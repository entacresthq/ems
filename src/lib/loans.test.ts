import { describe, expect, it } from 'vitest'
import { buildSchedule, dueDates, respread, standing, type Calendar } from './loans'
import { naira } from './money'

const cal: Calendar = { workingDays: [1, 2, 3, 4, 5, 6], holidays: ['2026-10-01'] }

describe('due dates', () => {
  it('skips Sundays and holidays for daily loans', () => {
    // Fri 25 Sep 2026 → Sat 26, (Sun 27 closed) Mon 28, Tue 29, Wed 30, (Thu 1 Oct holiday) Fri 2
    expect(dueDates('2026-09-25', 'daily', 5, cal)).toEqual([
      '2026-09-26',
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-02',
    ])
  })

  it('moves weekly and monthly dates off closed days', () => {
    // 24 Sep + 7 = 1 Oct (holiday) → 2 Oct
    expect(dueDates('2026-09-24', 'weekly', 1, cal)).toEqual(['2026-10-02'])
    // 31 Jan + 1 month = 28 Feb 2026 (a Saturday, open)
    expect(dueDates('2026-01-31', 'monthly', 1, cal)).toEqual(['2026-02-28'])
  })
})

describe('schedules', () => {
  it('charges flat interest on the original amount', () => {
    // ₦100,000 at 4% a month over 26 daily installments (one month) → ₦4,000 interest
    const q = buildSchedule(
      {
        principal: naira(100_000),
        monthlyRatePercent: '4.00',
        interestMethod: 'flat',
        frequency: 'daily',
        installmentCount: 26,
      },
      '2026-09-25',
      cal,
    )
    expect(q.interest).toBe(naira(4_000))
    expect(q.totalRepayable).toBe(naira(104_000))
    expect(q.rows).toHaveLength(26)
    expect(q.rows.reduce((s, r) => s + r.amount, 0)).toBe(naira(104_000))
    expect(q.rows.reduce((s, r) => s + r.principal, 0)).toBe(naira(100_000))
  })

  it('charges less on a reducing balance than flat for the same rate', () => {
    const terms = {
      principal: naira(1_000_000),
      monthlyRatePercent: '3.00',
      frequency: 'monthly' as const,
      installmentCount: 12,
    }
    const flat = buildSchedule({ ...terms, interestMethod: 'flat' }, '2026-09-25', cal)
    const reducing = buildSchedule(
      { ...terms, interestMethod: 'reducing_balance' },
      '2026-09-25',
      cal,
    )
    expect(flat.interest).toBe(naira(360_000))
    expect(reducing.interest).toBeLessThan(flat.interest)
    expect(reducing.rows.reduce((s, r) => s + r.principal, 0)).toBe(naira(1_000_000))
    // Interest falls as the balance falls.
    expect(reducing.rows[0]!.interest).toBeGreaterThan(reducing.rows[11]!.interest)
  })

  it('spreads an extension without adding interest', () => {
    const rows = respread(naira(10_000), 3, 'weekly', '2026-09-25', 5, cal)
    expect(rows.map((r) => r.amount)).toEqual([333_334, 333_334, 333_332]) // kobo; sums to ₦10,000
    expect(rows[0]!.number).toBe(5)
  })
})

describe('standing', () => {
  const rows = buildSchedule(
    {
      principal: naira(10_000),
      monthlyRatePercent: '0',
      interestMethod: 'flat',
      frequency: 'weekly',
      installmentCount: 4,
    },
    '2026-09-01',
    { workingDays: [0, 1, 2, 3, 4, 5, 6], holidays: [] },
  ).rows // due 8, 15, 22, 29 Sep, ₦2,500 each

  it('allocates payments in order and finds arrears', () => {
    const s = standing(rows, naira(3_000), '2026-09-23', {
      percentPerDay: '1.00',
      graceDays: 2,
      capPercent: '20.00',
    })
    expect(s.rows.map((r) => r.status)).toEqual(['paid', 'part_paid', 'overdue', 'upcoming'])
    expect(s.arrears).toBe(naira(4_500)) // ₦2,000 left of #2 + ₦2,500 of #3
    expect(s.daysInArrears).toBe(8) // since 15 Sep
    // 1% a day for 6 days = 6% of ₦4,500 = ₦270 (under the 20% cap)
    expect(s.penaltyDue).toBe(naira(270))
    expect(s.nextDue?.number).toBe(4)
  })

  it('has no arrears when payments are up to date', () => {
    const s = standing(rows, naira(5_000), '2026-09-15', null)
    expect(s.arrears).toBe(0)
    expect(s.daysInArrears).toBe(0)
  })
})
