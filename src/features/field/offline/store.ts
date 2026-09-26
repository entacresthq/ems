import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Kobo } from '@/lib/money'
import type { DueKind, GeoPoint, Id, IsoDate, IsoDateTime, PaymentMethod } from '@/types'

/**
 * On-device storage for the field app. Collections are written here first,
 * so nothing is lost if the network drops or the phone restarts.
 */

export type OutboxStatus = 'pending' | 'syncing' | 'synced' | 'failed'

export interface OutboxEntry {
  /** Client-generated idempotency key; the server ignores repeats of it. */
  key: string
  userId: Id
  day: IsoDate
  customerId: Id
  customerName: string
  accountId: Id
  accountNumber: string
  kind: DueKind
  productName: string
  amount: Kobo
  paymentMethod: PaymentMethod
  collectedAt: IsoDateTime
  location: GeoPoint | null
  status: OutboxStatus
  attempts: number
  error: string | null
  syncedAt: IsoDateTime | null
  reference: string | null
  smsStatus: 'sent' | 'queued' | 'failed' | null
  phoneHint: string | null
}

export interface CacheRecord<T = unknown> {
  savedAt: IsoDateTime
  data: T
}

interface FieldDb extends DBSchema {
  outbox: { key: string; value: OutboxEntry; indexes: { byUser: string } }
  cache: { key: string; value: CacheRecord }
}

let dbPromise: Promise<IDBPDatabase<FieldDb>> | null = null

export function fieldDb() {
  dbPromise ??= openDB<FieldDb>('ems-field', 1, {
    upgrade(db) {
      const outbox = db.createObjectStore('outbox', { keyPath: 'key' })
      outbox.createIndex('byUser', 'userId')
      db.createObjectStore('cache')
    },
  })
  return dbPromise
}

/** For tests: forget the open connection. */
export function resetFieldDbConnection() {
  dbPromise = null
}

export async function cachePut<T>(key: string, data: T) {
  const db = await fieldDb()
  await db.put('cache', { savedAt: new Date().toISOString(), data }, key)
}

export async function cacheGet<T>(key: string): Promise<CacheRecord<T> | undefined> {
  const db = await fieldDb()
  return (await db.get('cache', key)) as CacheRecord<T> | undefined
}
