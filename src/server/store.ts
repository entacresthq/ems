import { DatabaseSync } from 'node:sqlite'
import type { MockDb } from '@/mocks/seed/generate'
import type { BusinessSettings } from '@/types'

/**
 * SQLite storage for the desktop app. One table per collection, one row per
 * record, with the record as JSON (queryable with json_extract). A `seq`
 * column keeps each list in the order the app holds it: some lists add new
 * records at the front (newest first), others at the end.
 *
 * The app works on the data in memory and calls save() after every change;
 * save() writes only the rows that were added, changed or removed.
 */

const COLLECTIONS = {
  audit: 'audit_log',
  remittances: 'remittances',
  approvals: 'approvals',
  branches: 'branches',
  staff: 'staff',
  customers: 'customers',
  thriftPlans: 'thrift_plans',
  loanProducts: 'loan_products',
  accounts: 'accounts',
  loans: 'loans',
  transactions: 'transactions',
} as const satisfies Record<Exclude<keyof MockDb, 'settings'>, string>

type Collection = keyof typeof COLLECTIONS
type Row = { id: string }

export const SCHEMA_VERSION = 1

export interface SmsMessage {
  id: number
  sentAt: string
  to: string
  message: string
}

interface TableState {
  /** id → the JSON last written, to spot changes. */
  written: Map<string, string>
  minSeq: number
  maxSeq: number
}

export class Store {
  private readonly sql: DatabaseSync
  private readonly tables = new Map<Collection, TableState>()
  private writtenSettings = ''

  constructor(file: string) {
    this.sql = new DatabaseSync(file)
    this.sql.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sms_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sent_at TEXT NOT NULL,
        to_phone TEXT NOT NULL,
        message TEXT NOT NULL
      );
    `)
    for (const table of Object.values(COLLECTIONS)) {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS ${table} (
          id TEXT PRIMARY KEY,
          seq REAL NOT NULL,
          data TEXT NOT NULL CHECK (json_valid(data))
        );
        CREATE INDEX IF NOT EXISTS ${table}_seq ON ${table} (seq);
      `)
    }
    if (!this.getMeta('schema_version')) this.setMeta('schema_version', String(SCHEMA_VERSION))
  }

  getMeta(key: string): string | null {
    const row = this.sql.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      { value: string } | undefined
    return row?.value ?? null
  }

  setMeta(key: string, value: string) {
    this.sql
      .prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value)
  }

  /** The saved data, or null before onboarding. */
  load(): MockDb | null {
    const settings = this.getMeta('settings')
    if (!settings) return null
    this.writtenSettings = settings
    const data = { settings: JSON.parse(settings) as BusinessSettings } as MockDb
    for (const [collection, table] of Object.entries(COLLECTIONS) as [Collection, string][]) {
      const rows = this.sql.prepare(`SELECT id, seq, data FROM ${table} ORDER BY seq`).all() as {
        id: string
        seq: number
        data: string
      }[]
      const state: TableState = {
        written: new Map(rows.map((r) => [r.id, r.data])),
        minSeq: rows[0]?.seq ?? 0,
        maxSeq: rows.at(-1)?.seq ?? 0,
      }
      this.tables.set(collection, state)
      ;(data[collection] as unknown[]) = rows.map((r) => JSON.parse(r.data) as unknown)
    }
    return data
  }

  /** Write whatever changed since the last save, in one transaction. */
  save(data: MockDb) {
    this.sql.exec('BEGIN')
    try {
      const settings = JSON.stringify(data.settings)
      if (settings !== this.writtenSettings) {
        this.setMeta('settings', settings)
        this.writtenSettings = settings
      }
      for (const [collection, table] of Object.entries(COLLECTIONS) as [Collection, string][]) {
        this.saveTable(table, this.state(collection), data[collection] as Row[])
      }
      this.sql.exec('COMMIT')
    } catch (error) {
      this.sql.exec('ROLLBACK')
      throw error
    }
  }

  private state(collection: Collection): TableState {
    let state = this.tables.get(collection)
    if (!state) {
      state = { written: new Map(), minSeq: 0, maxSeq: 0 }
      this.tables.set(collection, state)
    }
    return state
  }

  private saveTable(table: string, state: TableState, rows: Row[]) {
    const upsert = this.sql.prepare(
      `INSERT INTO ${table} (id, seq, data) VALUES (?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
    )
    const remove = this.sql.prepare(`DELETE FROM ${table} WHERE id = ?`)
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
      upsert.run(row.id, seq, json)
      state.written.set(row.id, json)
    })
    for (const id of [...state.written.keys()]) {
      if (!seen.has(id)) {
        remove.run(id)
        state.written.delete(id)
      }
    }
  }

  addSms(to: string, message: string): SmsMessage {
    const sentAt = new Date().toISOString()
    const result = this.sql
      .prepare('INSERT INTO sms_outbox (sent_at, to_phone, message) VALUES (?, ?, ?)')
      .run(sentAt, to, message)
    return { id: Number(result.lastInsertRowid), sentAt, to, message }
  }

  listSms(limit = 50): SmsMessage[] {
    return (
      this.sql
        .prepare('SELECT id, sent_at, to_phone, message FROM sms_outbox ORDER BY id DESC LIMIT ?')
        .all(limit) as { id: number; sent_at: string; to_phone: string; message: string }[]
    ).map((r) => ({ id: r.id, sentAt: r.sent_at, to: r.to_phone, message: r.message }))
  }

  /** A consistent copy of the whole database, safe to take while the app runs. */
  backup(file: string) {
    this.sql.prepare('VACUUM INTO ?').run(file)
  }

  close() {
    this.sql.close()
  }
}
