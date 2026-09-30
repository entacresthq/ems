import type { MockDb } from '@/mocks/seed/generate'
import { migrateLoanRecords } from '@/mocks/migrate'
import type { BusinessSettings } from '@/types'
import { SqliteBackend } from './storage/sqlite'
import {
  COLLECTIONS,
  SCHEMA_VERSION,
  TABLES,
  emptyChanges,
  hasChanges,
  type Backend,
  type Changes,
  type Collection,
  type SmsMessage,
  type Snapshot,
  type StoredRow,
  type Table,
} from './storage/types'

export type { SmsMessage } from './storage/types'

/**
 * The app works on its data in memory; the Store writes what changed to the
 * backend (SQLite or PostgreSQL). One table per collection, one row per record,
 * the record as JSON. A `seq` column keeps each list in the order the app holds
 * it: some lists add new records at the front (newest first), others at the end.
 *
 * Writes are queued in order. The server waits for them (flush) before answering
 * a request, so a reply always means the change is saved. If a write fails the
 * store stops accepting work, because memory and database no longer agree.
 */

interface TableState {
  /** id → the JSON last written, to spot changes. */
  written: Map<string, string>
  minSeq: number
  maxSeq: number
}

type Row = { id: string }

export class Store {
  private readonly meta: Map<string, string>
  private readonly tables = new Map<Collection, TableState>()
  private writtenSettings = ''
  private queue: Promise<void> = Promise.resolve()
  private failure: Error | null = null

  private constructor(
    readonly backend: Backend,
    private snapshot: Snapshot | null,
  ) {
    this.meta = new Map(Object.entries(snapshot?.meta ?? {}))
  }

  static async open(backend: Backend): Promise<Store> {
    const store = new Store(backend, await backend.init())
    if (!store.getMeta('schema_version')) store.setMeta('schema_version', String(SCHEMA_VERSION))
    return store
  }

  /** Set when a write failed; nothing else is written after that. */
  get failed(): Error | null {
    return this.failure
  }

  getMeta(key: string): string | null {
    return this.meta.get(key) ?? null
  }

  setMeta(key: string, value: string) {
    this.meta.set(key, value)
    this.enqueue({ ...emptyChanges(), meta: [[key, value]] })
  }

  /** The saved data, or null before onboarding. Call once, at start-up. */
  load(): MockDb | null {
    const snapshot = this.snapshot
    this.snapshot = null
    const settings = this.getMeta('settings')
    if (!snapshot || !settings) return null
    this.writtenSettings = settings
    const data = { settings: JSON.parse(settings) as BusinessSettings } as MockDb
    for (const [collection, table] of Object.entries(COLLECTIONS) as [Collection, Table][]) {
      const rows = snapshot.rows[table]
      const records = rows.map((r) => JSON.parse(r.data) as Row)
      this.tables.set(collection, {
        // Re-serialise: Postgres jsonb reorders keys, and the comparison must match save().
        written: new Map(records.map((record) => [record.id, JSON.stringify(record)])),
        minSeq: rows[0]?.seq ?? 0,
        maxSeq: rows.at(-1)?.seq ?? 0,
      })
      ;(data[collection] as unknown[]) = records
    }
    // Records saved before loan kinds existed are upgraded in memory; save() writes them back.
    migrateLoanRecords(data)
    return data
  }

  /** Queue whatever changed since the last save, as one transaction. */
  save(data: MockDb) {
    const changes = emptyChanges()
    const settings = JSON.stringify(data.settings)
    if (settings !== this.writtenSettings) {
      this.meta.set('settings', settings)
      changes.meta.push(['settings', settings])
      this.writtenSettings = settings
    }
    for (const [collection, table] of Object.entries(COLLECTIONS) as [Collection, Table][]) {
      this.diffTable(table, this.state(collection), data[collection] as Row[], changes)
    }
    if (hasChanges(changes)) this.enqueue(changes)
  }

  /** Wait for queued writes. Throws if any failed. */
  async flush(): Promise<void> {
    await this.queue
    if (this.failure) throw this.failure
  }

  async addSms(to: string, message: string): Promise<SmsMessage> {
    const sentAt = new Date().toISOString()
    let id = 0
    await this.run(async () => {
      id = await this.backend.addSms(sentAt, to, message)
    })
    return { id, sentAt, to, message }
  }

  async listSms(limit = 50): Promise<SmsMessage[]> {
    await this.flush()
    return this.backend.listSms(limit)
  }

  /** Write a complete copy of the current data to a new SQLite file. */
  async backup(file: string, data: MockDb | null) {
    await this.flush()
    const target = new SqliteBackend(file)
    try {
      await target.init()
      await target.apply(fullChanges([...this.meta], data))
    } finally {
      await target.close()
    }
  }

  async close() {
    await this.queue
    await this.backend.close()
  }

  private enqueue(changes: Changes) {
    void this.run(() => this.backend.apply(changes)).catch(() => undefined)
  }

  private run(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(async () => {
      if (this.failure) throw this.failure
      try {
        await task()
      } catch (error) {
        this.failure = error instanceof Error ? error : new Error(String(error))
        throw this.failure
      }
    })
    this.queue = next.catch(() => undefined)
    return next
  }

  private state(collection: Collection): TableState {
    let state = this.tables.get(collection)
    if (!state) {
      state = { written: new Map(), minSeq: 0, maxSeq: 0 }
      this.tables.set(collection, state)
    }
    return state
  }

  private diffTable(table: Table, state: TableState, rows: Row[], changes: Changes) {
    const upserts: StoredRow[] = []
    // New records before the first saved one were added at the front.
    const firstKnown = rows.findIndex((r) => state.written.has(r.id))
    const frontSeq = state.minSeq
    const seen = new Set<string>()
    rows.forEach((row, index) => {
      if (typeof row.id !== 'string') throw new Error(`A record in ${table} has no id.`)
      seen.add(row.id)
      const json = JSON.stringify(row)
      if (state.written.get(row.id) === json) return
      let seq = 0
      if (!state.written.has(row.id)) {
        if (state.written.size === 0) seq = index
        else if (firstKnown !== -1 && index < firstKnown) seq = frontSeq - (firstKnown - index)
        else seq = state.maxSeq + 1
        state.minSeq = Math.min(state.minSeq, seq)
        state.maxSeq = Math.max(state.maxSeq, seq)
      }
      upserts.push({ id: row.id, seq, data: json })
      state.written.set(row.id, json)
    })
    const deletes = [...state.written.keys()].filter((id) => !seen.has(id))
    for (const id of deletes) state.written.delete(id)
    if (upserts.length) changes.upserts[table] = upserts
    if (deletes.length) changes.deletes[table] = deletes
  }
}

/** Every meta value and record, in list order. */
function fullChanges(meta: [string, string][], data: MockDb | null): Changes {
  const changes: Changes = { meta, upserts: {}, deletes: {} }
  if (!data) return changes
  for (const [collection, table] of Object.entries(COLLECTIONS) as [Collection, Table][]) {
    changes.upserts[table] = (data[collection] as Row[]).map((row, seq) => ({
      id: row.id,
      seq,
      data: JSON.stringify(row),
    }))
  }
  return changes
}

/**
 * Copy one database into another, e.g. from this computer's SQLite file to a
 * new Supabase project. The target must be empty.
 */
export async function copyDatabase(source: Backend, target: Backend): Promise<{ records: number }> {
  try {
    const from = await source.init()
    const to = await target.init()
    if (to.meta.settings || TABLES.some((t) => to.rows[t].length > 0))
      throw new Error('The new database already has EMS data in it. Choose an empty one.')
    const changes: Changes = {
      meta: Object.entries(from.meta),
      upserts: from.rows,
      deletes: {},
    }
    await target.apply(changes)
    for (const sms of (await source.listSms(1000)).reverse())
      await target.addSms(sms.sentAt, sms.to, sms.message)
    return { records: TABLES.reduce((n, t) => n + from.rows[t].length, 0) }
  } finally {
    await source.close()
    await target.close()
  }
}
