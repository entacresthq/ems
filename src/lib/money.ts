/**
 * Money is handled as integer kobo on the client. The API (DRF DecimalField)
 * sends and receives decimal strings such as "1250000.00". Floats are never used.
 */
export type Kobo = number & { readonly __brand: 'Kobo' }

export function kobo(value: number): Kobo {
  if (!Number.isSafeInteger(value))
    throw new RangeError(`Kobo must be a safe integer, got ${value}`)
  return value as Kobo
}

export const ZERO = kobo(0)

/** Whole naira to kobo. Only for integer naira values (seed data, constants). */
export function naira(value: number): Kobo {
  return kobo(value * 100)
}

/** Parse a DRF decimal string ("1250000.00", "-50.5") into kobo without float maths. */
export function parseDecimal(value: string): Kobo {
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim())
  if (!match) throw new Error(`Invalid decimal amount: "${value}"`)
  const [, sign, whole = '0', frac = ''] = match
  const total = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
  return kobo(sign ? -total : total)
}

/** Kobo to a DRF decimal string: 125000000 → "1250000.00". */
export function toDecimal(amount: Kobo): string {
  const sign = amount < 0 ? '-' : ''
  const abs = Math.abs(amount)
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

const groupFormatter = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 })

interface FormatOptions {
  /** Drop ".00" when the amount has no kobo. */
  trimZeroKobo?: boolean
  /** Show "+" for positive amounts. */
  signed?: boolean
}

/** Format as ₦1,250,000.00 */
export function formatNaira(amount: Kobo, options: FormatOptions = {}): string {
  const abs = Math.abs(amount)
  const whole = groupFormatter.format(Math.trunc(abs / 100))
  const fraction = abs % 100
  const koboPart =
    options.trimZeroKobo && fraction === 0 ? '' : `.${String(fraction).padStart(2, '0')}`
  const sign = amount < 0 ? '−' : options.signed && amount > 0 ? '+' : ''
  return `${sign}₦${whole}${koboPart}`
}

/**
 * Parse what a person typed into a money field ("1,250,000", "₦500.5").
 * Returns null when it is not a valid non-negative amount.
 */
export function parseNairaInput(input: string): Kobo | null {
  const cleaned = input.replace(/[₦,\s]/g, '')
  if (cleaned === '') return null
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null
  const normalised = cleaned.endsWith('.') ? cleaned.slice(0, -1) : cleaned
  if (normalised.replace('.', '').length > 15) return null
  return parseDecimal(normalised)
}

/** Show kobo in an input as "1,250,000" or "1,250,000.50". */
export function formatNairaInput(amount: Kobo): string {
  return formatNaira(amount, { trimZeroKobo: true }).replace(/^−?₦/, '')
}

export function sumKobo(amounts: readonly Kobo[]): Kobo {
  return kobo(amounts.reduce<number>((sum, a) => sum + a, 0))
}

/**
 * Tailwind size class for a large displayed amount, stepping down as the
 * figure gets longer so it never runs off a phone screen.
 */
export function amountSizeClass(formatted: string, largest: 'lg' | 'md' = 'lg'): string {
  const steps =
    largest === 'lg'
      ? ['text-amount-lg', 'text-amount', 'text-amount-sm']
      : ['text-amount', 'text-amount-sm', 'text-xl']
  // Plex tabular digits are about 0.6em wide; these limits fit a 360px screen.
  if (formatted.length <= (largest === 'lg' ? 9 : 10)) return steps[0]!
  if (formatted.length <= 14) return steps[1]!
  return steps[2]!
}
