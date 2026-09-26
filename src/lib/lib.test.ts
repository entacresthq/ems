import { describe, expect, it } from 'vitest'
import { isValidBvn, maskBvn } from './bvn'
import { camelToSnake, keysToCamel, keysToSnake, snakeToCamel } from './case'
import { formatDate, formatDateTime, toIsoDate } from './dates'
import {
  formatNaira,
  formatNairaInput,
  kobo,
  naira,
  parseDecimal,
  parseNairaInput,
  toDecimal,
} from './money'
import { hasPermission, homePathFor, ROLE_PERMISSIONS } from './permissions'
import { formatPhone, normalisePhone, phoneSchema, toE164 } from './phone'

describe('money', () => {
  it('formats naira with grouping and kobo', () => {
    expect(formatNaira(kobo(125_000_000))).toBe('₦1,250,000.00')
    expect(formatNaira(kobo(5))).toBe('₦0.05')
    expect(formatNaira(kobo(-250_050))).toBe('−₦2,500.50')
    expect(formatNaira(naira(2000), { trimZeroKobo: true })).toBe('₦2,000')
    expect(formatNaira(naira(10_000_000))).toBe('₦10,000,000.00')
  })

  it('round-trips DRF decimal strings without floats', () => {
    expect(parseDecimal('1250000.00')).toBe(125_000_000)
    expect(parseDecimal('0.1')).toBe(10)
    expect(parseDecimal('-50.5')).toBe(-5050)
    expect(toDecimal(kobo(125_000_000))).toBe('1250000.00')
    expect(toDecimal(kobo(-5))).toBe('-0.05')
    // 0.1 + 0.2 style float errors cannot happen.
    expect(parseDecimal('0.10') + parseDecimal('0.20')).toBe(30)
    expect(() => parseDecimal('1,000')).toThrow()
  })

  it('parses what people type into money fields', () => {
    expect(parseNairaInput('1,250,000')).toBe(125_000_000)
    expect(parseNairaInput('₦ 500.5')).toBe(50_050)
    expect(parseNairaInput('500.')).toBe(50_000)
    expect(parseNairaInput('')).toBeNull()
    expect(parseNairaInput('12.345')).toBeNull()
    expect(parseNairaInput('abc')).toBeNull()
    expect(formatNairaInput(kobo(125_000_050))).toBe('1,250,000.50')
  })
})

describe('dates', () => {
  it('formats in Africa/Lagos as 25 Sep 2026', () => {
    expect(formatDate('2026-09-25')).toBe('25 Sep 2026')
    // 23:30 UTC is already the next day in Lagos (UTC+1).
    expect(formatDate('2026-09-25T23:30:00Z')).toBe('26 Sep 2026')
    expect(formatDateTime('2026-09-25T13:05:00Z')).toBe('25 Sep 2026, 14:05')
    expect(toIsoDate('2026-12-31T23:30:00Z')).toBe('2027-01-01')
  })
})

describe('phone', () => {
  it('accepts local and international Nigerian mobile numbers', () => {
    expect(normalisePhone('0803 123 4567')).toBe('08031234567')
    expect(normalisePhone('+234 803 123 4567')).toBe('08031234567')
    expect(normalisePhone('2348031234567')).toBe('08031234567')
    expect(normalisePhone('0701-234-5678')).toBe('07012345678')
    expect(toE164('08031234567')).toBe('+2348031234567')
    expect(formatPhone('+2348031234567')).toBe('0803 123 4567')
  })

  it('rejects numbers that are not Nigerian mobiles', () => {
    expect(normalisePhone('0803123456')).toBeNull()
    expect(normalisePhone('0603 123 4567')).toBeNull()
    expect(normalisePhone('+44 7700 900123')).toBeNull()
    expect(phoneSchema.safeParse('12345').success).toBe(false)
    expect(phoneSchema.parse(' +2348031234567 ')).toBe('08031234567')
  })
})

describe('bvn', () => {
  it('requires exactly 11 digits', () => {
    expect(isValidBvn('22123456789')).toBe(true)
    expect(isValidBvn('2212345678')).toBe(false)
    expect(isValidBvn('2212345678a')).toBe(false)
    expect(maskBvn('22123456789')).toBe('•••••••6789')
  })
})

describe('case conversion', () => {
  it('converts keys deeply both ways', () => {
    expect(snakeToCamel('next_of_kin')).toBe('nextOfKin')
    expect(camelToSnake('accuracyM')).toBe('accuracy_m')
    expect(
      keysToCamel({
        page_size: 1,
        results: [{ customer_name: 'A', next_of_kin: { full_name: 'B' } }],
      }),
    ).toEqual({
      pageSize: 1,
      results: [{ customerName: 'A', nextOfKin: { fullName: 'B' } }],
    })
    expect(keysToSnake({ dateFrom: '2026-09-01', nested: [{ pageSize: 2 }] })).toEqual({
      date_from: '2026-09-01',
      nested: [{ page_size: 2 }],
    })
  })
})

describe('permissions', () => {
  it('keeps officers in the field app and out of back-office actions', () => {
    const officer = {
      role: 'account_officer' as const,
      permissions: [...ROLE_PERMISSIONS.account_officer],
    }
    expect(homePathFor(officer)).toBe('/field/today')
    expect(hasPermission(officer, 'field.collect')).toBe(true)
    expect(hasPermission(officer, 'loans.approve')).toBe(false)
    expect(hasPermission(officer, 'dashboard.view')).toBe(false)
  })

  it('separates makers from checkers', () => {
    expect(ROLE_PERMISSIONS.accountant).toContain('transactions.request_reversal')
    expect(ROLE_PERMISSIONS.accountant).not.toContain('approvals.decide')
    expect(ROLE_PERMISSIONS.branch_manager).toContain('approvals.decide')
    expect(ROLE_PERMISSIONS.md).not.toContain('field.collect')
  })
})
