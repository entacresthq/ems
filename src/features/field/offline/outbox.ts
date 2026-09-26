import { fieldApi } from '@/api/field'
import { isApiError } from '@/api/client'
import type { Id } from '@/types'
import { fieldDb, type OutboxEntry } from './store'

/**
 * Outbox for field collections.
 *
 * Every collection is saved on the phone first, then sent to the server.
 * Each entry carries a client-generated idempotency key, so sending the same
 * entry twice (e.g. the response was lost on a weak signal) never creates a
 * second transaction.
 *
 * - Network errors and server errors (5xx) leave the entry pending for later.
 * - Validation errors (4xx) mark it failed with the server's message, because
 *   retrying will not help; the officer must see it and act.
 */

type Listener = () => void
const listeners = new Set<Listener>()

export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify() {
  listeners.forEach((l) => l())
}

export async function listOutbox(userId: Id): Promise<OutboxEntry[]> {
  const db = await fieldDb()
  const entries = await db.getAllFromIndex('outbox', 'byUser', userId)
  return entries.sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))
}

export async function getOutboxEntry(key: string): Promise<OutboxEntry | undefined> {
  return (await fieldDb()).get('outbox', key)
}

async function put(entry: OutboxEntry) {
  await (await fieldDb()).put('outbox', entry)
  notify()
}

export async function addToOutbox(entry: OutboxEntry) {
  await put(entry)
}

/** Remove a failed entry the officer has dealt with (e.g. handed the cash to the accountant). */
export async function discardEntry(key: string) {
  const db = await fieldDb()
  const entry = await db.get('outbox', key)
  if (entry && entry.status !== 'synced') {
    await db.delete('outbox', key)
    notify()
  }
}

/** Put a failed entry back in the queue, e.g. after the account was unfrozen. */
export async function retryEntry(key: string) {
  const entry = await getOutboxEntry(key)
  if (entry && entry.status === 'failed') await put({ ...entry, status: 'pending', error: null })
}

/** Housekeeping on start-up: recover interrupted syncs and drop old synced entries. */
export async function tidyOutbox(userId: Id, keepDays = 7) {
  const cutoff = Date.now() - keepDays * 86_400_000
  const db = await fieldDb()
  for (const entry of await db.getAllFromIndex('outbox', 'byUser', userId)) {
    if (entry.status === 'syncing') await db.put('outbox', { ...entry, status: 'pending' })
    else if (entry.status === 'synced' && new Date(entry.collectedAt).getTime() < cutoff)
      await db.delete('outbox', entry.key)
  }
  notify()
}

export interface SyncResult {
  synced: number
  failed: number
  /** True when sending stopped because the server could not be reached. */
  interrupted: boolean
}

let running: Promise<SyncResult> | null = null

/** Send pending collections, oldest first. Only one sync runs at a time. */
export function syncOutbox(userId: Id): Promise<SyncResult> {
  running ??= (async () => {
    const result: SyncResult = { synced: 0, failed: 0, interrupted: false }
    try {
      const pending = (await listOutbox(userId)).filter((e) => e.status === 'pending').reverse()
      for (const entry of pending) {
        await put({ ...entry, status: 'syncing', attempts: entry.attempts + 1 })
        try {
          const res = await fieldApi.collect({
            idempotencyKey: entry.key,
            accountId: entry.accountId,
            amount: entry.amount,
            paymentMethod: entry.paymentMethod,
            collectedAt: entry.collectedAt,
            location: entry.location,
          })
          await put({
            ...entry,
            status: 'synced',
            attempts: entry.attempts + 1,
            error: null,
            syncedAt: new Date().toISOString(),
            reference: res.transaction.reference,
            smsStatus: res.receipt.smsStatus,
            phoneHint: res.receipt.phone,
          })
          result.synced++
        } catch (error) {
          const retryable =
            !isApiError(error) ||
            error.isNetworkError ||
            error.status >= 500 ||
            error.status === 401 ||
            error.status === 429
          if (retryable) {
            await put({ ...entry, status: 'pending', attempts: entry.attempts + 1 })
            result.interrupted = true
            break
          }
          const fieldMessages = Object.values(error.fieldErrors).flat()
          await put({
            ...entry,
            status: 'failed',
            attempts: entry.attempts + 1,
            error: [...error.formErrors, ...fieldMessages].join(' ') || error.message,
          })
          result.failed++
        }
      }
      return result
    } finally {
      running = null
    }
  })()
  return running
}
