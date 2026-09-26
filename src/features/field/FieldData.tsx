import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { fieldApi, fieldKeys } from '@/api/field'
import { isApiError } from '@/api/client'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { toLagosIso, todayIso } from '@/lib/dates'
import { kobo, type Kobo } from '@/lib/money'
import type { Due, FieldToday, GeoPoint, PaymentMethod, Portfolio, TodayItem } from '@/types'
import {
  addToOutbox,
  getOutboxEntry,
  listOutbox,
  subscribeOutbox,
  syncOutbox,
  tidyOutbox,
  type SyncResult,
} from './offline/outbox'
import { cacheGet, cachePut, type OutboxEntry } from './offline/store'

// ── Outbox context ────────────────────────────────────────────────────────

export interface NewCollection {
  customerId: string
  customerName: string
  accountId: string
  accountNumber: string
  kind: OutboxEntry['kind']
  productName: string
  amount: Kobo
  paymentMethod: PaymentMethod
  location: GeoPoint | null
}

interface FieldDataValue {
  entries: OutboxEntry[]
  /** Waiting to reach the server (pending or sending now). */
  unsyncedCount: number
  failedCount: number
  syncing: boolean
  lastSync: (SyncResult & { at: number }) | null
  sync: () => Promise<SyncResult>
  /** Save to the phone, then try to send straight away (waits a few seconds). */
  record: (input: NewCollection) => Promise<OutboxEntry>
}

const FieldDataContext = createContext<FieldDataValue | null>(null)
const SYNC_INTERVAL_MS = 30_000
const RECORD_WAIT_MS = 8_000

export function FieldDataProvider({ children }: { children: ReactNode }) {
  const user = useCurrentUser()
  const queryClient = useQueryClient()
  const [entries, setEntries] = useState<OutboxEntry[]>([])
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<FieldDataValue['lastSync']>(null)

  // Download today's list and the whole portfolio as soon as the app opens, so
  // every screen works if the signal drops before the officer visits it.
  usePortfolio()
  useTodayData()

  const reload = useCallback(async () => setEntries(await listOutbox(user.id)), [user.id])

  const sync = useCallback(async () => {
    setSyncing(true)
    try {
      const result = await syncOutbox(user.id)
      setLastSync({ ...result, at: Date.now() })
      if (result.synced > 0 || result.failed > 0)
        await queryClient.invalidateQueries({ queryKey: fieldKeys.all })
      return result
    } finally {
      setSyncing(false)
    }
  }, [user.id, queryClient])

  useEffect(() => {
    const unsubscribe = subscribeOutbox(() => void reload())
    void tidyOutbox(user.id).then(() => sync())
    return () => {
      unsubscribe()
    }
  }, [user.id, reload, sync])

  const unsyncedCount = entries.filter(
    (e) => e.status === 'pending' || e.status === 'syncing',
  ).length
  const hasPending = unsyncedCount > 0

  // Retry when the network returns, and every 30 seconds while anything is waiting.
  useEffect(() => {
    const onOnline = () => void sync()
    window.addEventListener('online', onOnline)
    const timer = hasPending
      ? window.setInterval(() => navigator.onLine && void sync(), SYNC_INTERVAL_MS)
      : undefined
    return () => {
      window.removeEventListener('online', onOnline)
      if (timer) window.clearInterval(timer)
    }
  }, [hasPending, sync])

  const record = useCallback(
    async (input: NewCollection) => {
      const entry: OutboxEntry = {
        ...input,
        key: crypto.randomUUID(),
        userId: user.id,
        day: todayIso(),
        collectedAt: toLagosIso(),
        status: 'pending',
        attempts: 0,
        error: null,
        syncedAt: null,
        reference: null,
        smsStatus: null,
        phoneHint: null,
      }
      await addToOutbox(entry)
      if (navigator.onLine) {
        await Promise.race([sync(), new Promise((r) => setTimeout(r, RECORD_WAIT_MS))])
      }
      return (await getOutboxEntry(entry.key)) ?? entry
    },
    [user.id, sync],
  )

  const value = useMemo<FieldDataValue>(
    () => ({
      entries,
      unsyncedCount,
      failedCount: entries.filter((e) => e.status === 'failed').length,
      syncing,
      lastSync,
      sync,
      record,
    }),
    [entries, unsyncedCount, syncing, lastSync, sync, record],
  )

  return <FieldDataContext.Provider value={value}>{children}</FieldDataContext.Provider>
}

export function useFieldData() {
  const ctx = useContext(FieldDataContext)
  if (!ctx) throw new Error('useFieldData must be used inside FieldDataProvider')
  return ctx
}

// ── Cached reads ──────────────────────────────────────────────────────────

export interface Cached<T> {
  data: T
  savedAt: string
  /** True when the network failed and this came from the phone. */
  fromCache: boolean
}

/** Fetch from the server, keep a copy on the phone, and fall back to it offline. */
function useCachedQuery<T>(queryKey: QueryKey, cacheKey: string, fetcher: () => Promise<T>) {
  return useQuery<Cached<T>>({
    queryKey,
    networkMode: 'always',
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      try {
        const data = await fetcher()
        await cachePut(cacheKey, data).catch(() => undefined)
        return { data, savedAt: new Date().toISOString(), fromCache: false }
      } catch (error) {
        const offline = isApiError(error) && (error.isNetworkError || error.status >= 500)
        const cached = offline ? await cacheGet<T>(cacheKey).catch(() => undefined) : undefined
        if (cached) return { ...cached, fromCache: true }
        throw error
      }
    },
  })
}

export function usePortfolio() {
  const user = useCurrentUser()
  return useCachedQuery<Portfolio>(
    fieldKeys.portfolio(),
    `${user.id}:portfolio`,
    fieldApi.portfolio,
  )
}

export function useTodayData() {
  const user = useCurrentUser()
  return useCachedQuery<FieldToday>(fieldKeys.today(), `${user.id}:today`, fieldApi.today)
}

// ── Today, merged with collections not yet on the server ─────────────────

export interface DueView extends Due {
  /** Recorded on this phone but not yet included in the server figures. */
  localCollected: Kobo
  totalCollected: Kobo
  remaining: Kobo
  done: boolean
}

export interface TodayView extends Omit<TodayItem, 'dues'> {
  dues: DueView[]
  expected: Kobo
  collected: Kobo
  arrears: Kobo
  done: boolean
}

/** Local collections the server figures don't include yet. */
function localAmounts(
  entries: OutboxEntry[],
  day: string,
  savedAt: string | null,
): Map<string, Kobo> {
  const byAccount = new Map<string, Kobo>()
  for (const e of entries) {
    if (e.day !== day) continue
    const unsent = e.status === 'pending' || e.status === 'syncing'
    const sentAfterSnapshot =
      e.status === 'synced' && savedAt !== null && e.syncedAt !== null && e.syncedAt > savedAt
    if (unsent || sentAfterSnapshot)
      byAccount.set(e.accountId, kobo((byAccount.get(e.accountId) ?? 0) + e.amount))
  }
  return byAccount
}

export function useTodayView() {
  const query = useTodayData()
  const { entries } = useFieldData()
  const today = todayIso()

  const view = useMemo(() => {
    if (!query.data) return null
    const { data, savedAt } = query.data
    const local = localAmounts(entries, today, savedAt)
    const items: TodayView[] = data.items.map((item) => {
      const dues: DueView[] = item.dues.map((d) => {
        const localCollected = local.get(d.accountId) ?? kobo(0)
        const totalCollected = kobo(d.collectedToday + localCollected)
        const remaining = kobo(Math.max(0, d.amountDue - totalCollected))
        return {
          ...d,
          localCollected,
          totalCollected,
          remaining,
          done: d.amountDue > 0 ? remaining === 0 : totalCollected > 0,
        }
      })
      const sum = (f: (d: DueView) => number) => kobo(dues.reduce((n, d) => n + f(d), 0))
      return {
        ...item,
        dues,
        expected: sum((d) => d.amountDue),
        collected: sum((d) => d.totalCollected),
        arrears: sum((d) => d.arrears),
        done: dues.every((d) => d.done),
      }
    })
    const expected = kobo(items.reduce((n, i) => n + i.expected, 0))
    const collected = kobo(items.reduce((n, i) => n + i.collected, 0))
    return {
      items,
      expected,
      collected,
      visited: items.filter((i) => i.collected > 0).length,
      /** The list on the phone is from an earlier day. */
      outdated: data.date !== today,
      savedAt,
      fromCache: query.data.fromCache,
    }
  }, [query.data, entries, today])

  return { ...query, view }
}

export type { OutboxEntry }
