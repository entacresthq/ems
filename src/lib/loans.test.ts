import { describe, expect, it } from 'vitest'
import {
  buildSchedule,
  describeFee,
  describeInterest,
  describePenalty,
  dueDates,
  penaltyFor,
  processingFee,
  respread,
  standing,
  type Calendar,
} from './loans'
import { goalProgress } from './targetSavings'
import {
  DEFAULT_ACCOUNT_NUMBER_FORMAT,
  formatAccountNumber,
  nextSerial,
  previewAccountNumber,
  serialOf,
  validateAccountNumberFormat,
} from './accountNumber'
import { naira } from './money'

const fmt = (k: number) => `₦${k / 100}`

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
        ratePercent: '4.00',
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
      ratePercent: '3.00',
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

  it('charges an overall rate once, however long the loan runs', () => {
    const terms = {
      principal: naira(100_000),
      ratePercent: '15.00',
      interestBasis: 'overall' as const,
      interestMethod: 'flat' as const,
      frequency: 'weekly' as const,
    }
    const short = buildSchedule({ ...terms, installmentCount: 8 }, '2026-09-25', cal)
    const long = buildSchedule({ ...terms, installmentCount: 24 }, '2026-09-25', cal)
    expect(short.interest).toBe(naira(15_000))
    expect(long.interest).toBe(naira(15_000))
    expect(short.totalRepayable).toBe(naira(115_000))
    expect(short.rows.reduce((s, r) => s + r.amount, 0)).toBe(naira(115_000))
    expect(long.rows.reduce((s, r) => s + r.principal, 0)).toBe(naira(100_000))
  })

  it('treats an overall rate as flat even if reducing balance is passed', () => {
    const q = buildSchedule(
      {
        principal: naira(100_000),
        ratePercent: '10.00',
        interestBasis: 'overall',
        interestMethod: 'reducing_balance',
        frequency: 'monthly',
        installmentCount: 6,
      },
      '2026-09-25',
      cal,
    )
    expect(q.interest).toBe(naira(10_000))
  })

  it('still grows a monthly rate with the length of the loan', () => {
    const terms = {
      principal: naira(100_000),
      ratePercent: '4.00',
      interestBasis: 'monthly' as const,
      interestMethod: 'flat' as const,
      frequency: 'monthly' as const,
    }
    expect(buildSchedule({ ...terms, installmentCount: 3 }, '2026-09-25', cal).interest).toBe(
      naira(12_000),
    )
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
      ratePercent: '0',
      interestMethod: 'flat',
      frequency: 'weekly',
      installmentCount: 4,
    },
    '2026-09-01',
    { workingDays: [0, 1, 2, 3, 4, 5, 6], holidays: [] },
  ).rows // due 8, 15, 22, 29 Sep, ₦2,500 each

  it('allocates payments in order and finds arrears', () => {
    const s = standing(rows, naira(3_000), '2026-09-23', {
      type: 'percentage',
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

describe('processing fee', () => {
  it('supports percentage, flat and none', () => {
    expect(processingFee(naira(200_000), { type: 'percentage', percent: '2.50' })).toBe(
      naira(5_000),
    )
    expect(processingFee(naira(200_000), { type: 'flat', amount: naira(3_000) })).toBe(naira(3_000))
    expect(processingFee(naira(200_000), { type: 'none' })).toBe(0)
  })

  it('describes each rule', () => {
    expect(describeFee({ type: 'none' }, fmt)).toBe('None')
    expect(describeFee({ type: 'flat', amount: naira(3_000) }, fmt)).toBe('₦3000 flat')
    expect(describeFee({ type: 'percentage', percent: '2.00' }, fmt)).toBe('2.00% of the amount')
  })
})

describe('late penalty', () => {
  it('charges a percentage of arrears a day, up to the cap', () => {
    const rule = {
      type: 'percentage',
      percentPerDay: '1.00',
      graceDays: 0,
      capPercent: '5.00',
    } as const
    expect(penaltyFor(rule, naira(10_000), 3)).toBe(naira(300))
    expect(penaltyFor(rule, naira(10_000), 30)).toBe(naira(500))
  })

  it('charges a flat amount a day, up to the cap', () => {
    const rule = {
      type: 'flat',
      amountPerDay: naira(200),
      graceDays: 0,
      capPercent: '10.00',
    } as const
    expect(penaltyFor(rule, naira(10_000), 3)).toBe(naira(600))
    // 10% of ₦10,000 = ₦1,000
    expect(penaltyFor(rule, naira(10_000), 30)).toBe(naira(1_000))
    expect(penaltyFor(rule, naira(10_000), 0)).toBe(0)
  })

  it('applies a flat penalty in standing after the grace period', () => {
    const rows = buildSchedule(
      {
        principal: naira(10_000),
        ratePercent: '0',
        interestMethod: 'flat',
        frequency: 'weekly',
        installmentCount: 4,
      },
      '2026-09-01',
      { workingDays: [0, 1, 2, 3, 4, 5, 6], holidays: [] },
    ).rows // due 8, 15, 22, 29 Sep, ₦2,500 each
    const s = standing(rows, naira(0), '2026-09-13', {
      type: 'flat',
      amountPerDay: naira(100),
      graceDays: 2,
      capPercent: '50.00',
    })
    // ₦2,500 due 8 Sep, 5 days late, 2 days grace → 3 days × ₦100
    expect(s.daysInArrears).toBe(5)
    expect(s.penaltyDue).toBe(naira(300))
  })

  it('describes the rules', () => {
    expect(
      describePenalty(
        { type: 'flat', amountPerDay: naira(200), graceDays: 3, capPercent: '20.00' },
        fmt,
      ),
    ).toBe('₦200 a day after 3 days, up to 20.00% of arrears')
    expect(
      describeInterest({ ratePercent: '15.00', interestBasis: 'overall', interestMethod: 'flat' }),
    ).toBe('15.00% overall')
    expect(
      describeInterest({
        ratePercent: '3.00',
        interestBasis: 'monthly',
        interestMethod: 'reducing_balance',
      }),
    ).toBe('3.00% a month, reducing balance')
  })
})

describe('target savings progress', () => {
  const target = {
    goalName: 'School fees',
    targetAmount: naira(120_000),
    targetDate: '2026-12-25',
    lockUntilReached: true,
  }

  it('shows how far along the goal is and what to save', () => {
    const p = goalProgress(target, naira(30_000), '2026-09-25')
    expect(p.percent).toBe(25)
    expect(p.remaining).toBe(naira(90_000))
    expect(p.daysLeft).toBe(91)
    expect(p.reached).toBe(false)
    expect(p.locked).toBe(true)
    // 91 days = 13 weeks, and 4 months of 30 days (rounded up).
    expect(p.perWeek).toBe(692_308) // ₦90,000 / 13 = ₦6,923.08 in kobo, rounded up
    expect(p.perMonth).toBe(naira(22_500)) // ₦90,000 / 4
  })

  it('unlocks once the goal is reached, and stops suggesting amounts', () => {
    const p = goalProgress(target, naira(120_000), '2026-09-25')
    expect(p.reached).toBe(true)
    expect(p.locked).toBe(false)
    expect(p.perWeek).toBe(null)
    expect(p.percent).toBe(100)
  })

  it('unlocks after the target date even if the goal was not reached', () => {
    const p = goalProgress(target, naira(50_000), '2026-12-26')
    expect(p.overdue).toBe(true)
    expect(p.locked).toBe(false)
    expect(p.perWeek).toBe(null)
  })

  it('does not lock when the customer did not ask for it', () => {
    expect(
      goalProgress({ ...target, lockUntilReached: false }, naira(1), '2026-09-25').locked,
    ).toBe(false)
  })
})

describe('account number format', () => {
  const branch = { branchCode: '21', productCode: '10', year: 2026 }

  it('keeps the original format by default', () => {
    expect(formatAccountNumber(DEFAULT_ACCOUNT_NUMBER_FORMAT, { ...branch, serial: 1 })).toBe(
      '2110000001',
    )
  })

  it('builds a number from the chosen parts', () => {
    const f = {
      prefix: 'ems',
      includeBranch: true,
      includeProduct: false,
      includeYear: true,
      serialLength: 5,
      separator: '-' as const,
    }
    expect(previewAccountNumber({ ...f, prefix: 'EMS' })).toBe('EMS-21-26-00001')
    expect(
      formatAccountNumber(
        { ...f, prefix: 'EMS', includeBranch: false, includeYear: false },
        { ...branch, serial: 42 },
      ),
    ).toBe('EMS-00042')
  })

  it('reads the serial back and carries on after the highest one', () => {
    const f = DEFAULT_ACCOUNT_NUMBER_FORMAT
    expect(serialOf(f, '2110000007')).toBe(7)
    expect(serialOf(f, 'EMS-00007')).toBe(null)
    const build = (serial: number) => formatAccountNumber(f, { ...branch, serial })
    expect(nextSerial(f, ['2110000007', '2210000003'], build)).toBe(8)
    expect(nextSerial(f, [], build)).toBe(1)
  })

  it('starts again at 1 after a format change without clashing with old numbers', () => {
    const f = { ...DEFAULT_ACCOUNT_NUMBER_FORMAT, prefix: 'EMS', serialLength: 4 }
    const build = (serial: number) => formatAccountNumber(f, { ...branch, serial })
    expect(nextSerial(f, ['2110000007'], build)).toBe(1)
    expect(nextSerial(f, ['EMS21100001', '2110000007'], build)).toBe(2)
  })

  it('rejects formats that cannot work', () => {
    expect(validateAccountNumberFormat(DEFAULT_ACCOUNT_NUMBER_FORMAT)).toBe(null)
    expect(
      validateAccountNumberFormat({ ...DEFAULT_ACCOUNT_NUMBER_FORMAT, serialLength: 2 }),
    ).toMatch(/between 3 and 10/)
    expect(
      validateAccountNumberFormat({ ...DEFAULT_ACCOUNT_NUMBER_FORMAT, prefix: 'TOOLONG' }),
    ).toMatch(/prefix/)
    expect(
      validateAccountNumberFormat({ ...DEFAULT_ACCOUNT_NUMBER_FORMAT, prefix: 'A-B' }),
    ).toMatch(/prefix/)
    expect(
      validateAccountNumberFormat({
        prefix: 'ABCD',
        includeBranch: true,
        includeProduct: true,
        includeYear: true,
        serialLength: 10,
        separator: '-',
      }),
    ).toMatch(/at most 20/)
  })
})
