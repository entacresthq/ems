import type { MockDb } from '@/mocks/seed/generate'

/** App collection → table name. Every table has (id, seq, data). */
export const COLLECTIONS = {
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

export type Collection = keyof typeof COLLECTIONS
export type Table = (typeof COLLECTIONS)[Collection]
export const TABLES = Object.values(COLLECTIONS) as Table[]

export const SCHEMA_VERSION = 1

/** A stored record: `data` is the record as JSON text. */
export interface StoredRow {
  id: string
  seq: number
  data: string
}

export interface SmsMessage {
  id: number
  sentAt: string
  to: string
  message: string
}

/** Everything a backend holds, as read at start-up. */
export interface Snapshot {
  meta: Record<string, string>
  rows: Record<Table, StoredRow[]>
}

/** One transaction's worth of writes. */
export interface Changes {
  meta: [key: string, value: string][]
  upserts: Partial<Record<Table, StoredRow[]>>
  deletes: Partial<Record<Table, string[]>>
}

/** Where the data lives: SQLite on this computer, or PostgreSQL such as Supabase. */
export interface Backend {
  readonly kind: 'sqlite' | 'postgres'
  /** For messages: the file path or database host. */
  readonly label: string
  /** Create tables if needed and read everything. */
  init(): Promise<Snapshot>
  /** Apply the writes in one transaction. */
  apply(changes: Changes): Promise<void>
  addSms(sentAt: string, to: string, message: string): Promise<number>
  listSms(limit: number): Promise<SmsMessage[]>
  close(): Promise<void>
}

export const emptyChanges = (): Changes => ({ meta: [], upserts: {}, deletes: {} })

export const hasChanges = (c: Changes) =>
  c.meta.length > 0 ||
  Object.values(c.upserts).some((rows) => rows.length > 0) ||
  Object.values(c.deletes).some((ids) => ids.length > 0)
