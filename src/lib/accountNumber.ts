import type { AccountNumberFormat } from '@/types'

/** What accounts got before the format could be changed: 2 + 2 + 6 digits. */
export const DEFAULT_ACCOUNT_NUMBER_FORMAT: AccountNumberFormat = {
  prefix: '',
  includeBranch: true,
  includeProduct: true,
  includeYear: false,
  serialLength: 6,
  separator: '',
}

export const MAX_ACCOUNT_NUMBER_LENGTH = 20

export interface AccountNumberParts {
  branchCode: string
  productCode: string
  /** Four-digit year the account is opened. */
  year: number
  serial: number
}

const isSeparator = (v: unknown): v is AccountNumberFormat['separator'] => v === '' || v === '-'

function pieces(f: AccountNumberFormat, p: AccountNumberParts): string[] {
  const out: string[] = []
  if (f.prefix) out.push(f.prefix)
  if (f.includeBranch) out.push(p.branchCode.padStart(2, '0'))
  if (f.includeProduct) out.push(p.productCode.padStart(2, '0'))
  if (f.includeYear) out.push(String(p.year).slice(-2))
  out.push(String(p.serial).padStart(f.serialLength, '0'))
  return out
}

export function formatAccountNumber(f: AccountNumberFormat, p: AccountNumberParts): string {
  return pieces(f, p).join(f.separator)
}

/** Length of the numbers this format produces. */
export function accountNumberLength(f: AccountNumberFormat): number {
  return formatAccountNumber(f, { branchCode: '00', productCode: '00', year: 2000, serial: 0 }).length
}

/** An example for the settings screen. */
export function previewAccountNumber(f: AccountNumberFormat): string {
  return formatAccountNumber(f, { branchCode: '21', productCode: '10', year: 2026, serial: 1 })
}

/** Why a format can't be used, or null when it is fine. */
export function validateAccountNumberFormat(f: Partial<AccountNumberFormat> | undefined): string | null {
  if (!f) return 'Choose how account numbers are built.'
  if (typeof f.prefix !== 'string' || !/^[A-Za-z0-9]{0,4}$/.test(f.prefix))
    return 'The prefix can have up to 4 letters or digits.'
  if (typeof f.includeBranch !== 'boolean' || typeof f.includeProduct !== 'boolean' || typeof f.includeYear !== 'boolean')
    return 'Choose which parts to include.'
  if (!isSeparator(f.separator)) return 'The separator can be a dash or nothing.'
  if (!Number.isInteger(f.serialLength) || (f.serialLength as number) < 3 || (f.serialLength as number) > 10)
    return 'The serial number must have between 3 and 10 digits.'
  if (accountNumberLength(f as AccountNumberFormat) > MAX_ACCOUNT_NUMBER_LENGTH)
    return `Account numbers can be at most ${MAX_ACCOUNT_NUMBER_LENGTH} characters long.`
  return null
}

/** Clean up a format so it is safe to store (upper-case prefix, digits only for the length). */
export function normaliseAccountNumberFormat(f: AccountNumberFormat): AccountNumberFormat {
  return { ...f, prefix: f.prefix.toUpperCase(), serialLength: Number(f.serialLength) }
}

/** The running serial inside an account number made with this format, or null if it doesn't match. */
export function serialOf(f: AccountNumberFormat, accountNumber: string): number | null {
  const sep = f.separator
  const parts: string[] = []
  if (f.prefix) parts.push(f.prefix.toUpperCase().replace(/[^A-Z0-9]/g, ''))
  if (f.includeBranch) parts.push('\\d{2}')
  if (f.includeProduct) parts.push('\\d{2}')
  if (f.includeYear) parts.push('\\d{2}')
  parts.push(`(\\d{${f.serialLength}})`)
  const match = new RegExp(`^${parts.join(sep)}$`).exec(accountNumber.toUpperCase())
  return match ? Number(match[1]) : null
}

/** The next serial: one more than the highest already used with this format, skipping any taken number. */
export function nextSerial(
  f: AccountNumberFormat,
  existing: readonly string[],
  build: (serial: number) => string,
): number {
  let serial = 1
  for (const n of existing) {
    const s = serialOf(f, n)
    if (s !== null && s >= serial) serial = s + 1
  }
  const taken = new Set(existing.map((n) => n.toUpperCase()))
  const max = 10 ** f.serialLength - 1
  while (taken.has(build(serial).toUpperCase())) serial += 1
  if (serial > max) throw new Error('This account number format has run out of numbers. Add more serial digits in Settings.')
  return serial
}

/** True for anything that could be an account number, whatever the format. */
export const looksLikeAccountNumber = (v: string) => /^[A-Za-z0-9-]{6,24}$/.test(v.trim())
