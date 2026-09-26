import { parseDecimal, type Kobo } from '@/lib/money'
import type { Paginated } from '@/types'

/** Keys of T whose values are money. */
export type MoneyKeys<T> = { [K in keyof T]-?: NonNullable<T[K]> extends Kobo ? K : never }[keyof T]

/** The shape the API actually returns: money fields as DRF decimal strings. */
export type Wire<T> = {
  [K in keyof T]: K extends MoneyKeys<T> ? (null extends T[K] ? string | null : string) : T[K]
}

/** Convert the listed decimal-string fields to kobo. */
export function decodeMoney<T>(wire: Wire<T>, keys: readonly MoneyKeys<T>[]): T {
  const out: Record<string, unknown> = { ...(wire as Record<string, unknown>) }
  for (const key of keys) {
    const value = out[key as string]
    if (typeof value === 'string') out[key as string] = parseDecimal(value)
  }
  return out as T
}

export function decodePage<W, T>(page: Paginated<W>, decode: (item: W) => T): Paginated<T> {
  return { ...page, results: page.results.map(decode) }
}
