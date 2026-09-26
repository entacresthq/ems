export const TIME_ZONE = 'Africa/Lagos'

// Fixed labels: newer ICU data prints "Sept" for en-GB, and we want "Sep".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const weekdayFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, weekday: 'long' })

export interface LagosParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

function toDate(value: string | Date): Date {
  if (value instanceof Date) return value
  // Plain dates ("2026-09-25") mean that calendar day in Lagos, not UTC midnight.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T12:00:00+01:00`)
  return new Date(value)
}

export function lagosParts(value: string | Date): LagosParts {
  const parts = partsFormatter.formatToParts(toDate(value))
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 25 Sep 2026 */
export function formatDate(value: string | Date): string {
  const p = lagosParts(value)
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}`
}

/** 14:05 */
export function formatTime(value: string | Date): string {
  const p = lagosParts(value)
  return `${pad(p.hour)}:${pad(p.minute)}`
}

/** 25 Sep 2026, 14:05 */
export function formatDateTime(value: string | Date): string {
  return `${formatDate(value)}, ${formatTime(value)}`
}

/** Friday, 25 Sep 2026 */
export function formatLongDate(value: string | Date): string {
  return `${weekdayFormatter.format(toDate(value))}, ${formatDate(value)}`
}

/** Calendar date in Lagos as YYYY-MM-DD. */
export function toIsoDate(value: string | Date = new Date()): string {
  const p = lagosParts(value)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

export function todayIso(): string {
  return toIsoDate(new Date())
}

/** Timestamp in Lagos time with a fixed +01:00 offset (Nigeria has no daylight saving). */
export function toLagosIso(value: Date = new Date()): string {
  const shifted = new Date(value.getTime() + 60 * 60 * 1000)
  return shifted.toISOString().replace(/\.\d{3}Z$/, '+01:00')
}
