import { lagosParts, toIsoDate } from '@/lib/dates'

const DAY_MS = 86_400_000

function noon(iso: string): Date {
  return new Date(`${iso}T12:00:00+01:00`)
}

export function addDays(iso: string, days: number): string {
  return toIsoDate(new Date(noon(iso).getTime() + days * DAY_MS))
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(iso: string): number {
  return noon(iso).getUTCDay()
}

/** Field collections run Monday to Saturday. */
export function isWorkingDay(iso: string): boolean {
  return weekday(iso) !== 0
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((noon(toIso).getTime() - noon(fromIso).getTime()) / DAY_MS)
}

/** Working days from `fromIso` to `toIso` inclusive, ascending. */
export function workingDaysBetween(fromIso: string, toIso: string): string[] {
  const days: string[] = []
  for (let d = fromIso; d <= toIso; d = addDays(d, 1)) if (isWorkingDay(d)) days.push(d)
  return days
}

/** The date `count` working days before `iso` (exclusive of `iso`). */
export function subtractWorkingDays(iso: string, count: number): string {
  let d = iso
  let remaining = count
  while (remaining > 0) {
    d = addDays(d, -1)
    if (isWorkingDay(d)) remaining--
  }
  return d
}

/** "2026-09-25" + 14:05 → "2026-09-25T14:05:00+01:00" */
export function lagosTimestamp(iso: string, minutesFromMidnight: number): string {
  const h = String(Math.floor(minutesFromMidnight / 60)).padStart(2, '0')
  const m = String(minutesFromMidnight % 60).padStart(2, '0')
  return `${iso}T${h}:${m}:00+01:00`
}

export function nowMinutesInLagos(now: Date): number {
  const p = lagosParts(now)
  return p.hour * 60 + p.minute
}
