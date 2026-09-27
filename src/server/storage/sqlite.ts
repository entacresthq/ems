import { DatabaseSync } from 'node:sqlite'
import {
  TABLES,
  type Backend,
  type Changes,
  type SmsMessage,
  type Snapshot,
  type StoredRow,
  type Table,
} from './types'

/**
 * SQLite on this computer (node:sqlite, no native modules). Used by the desktop
 * app by default and by small single-office web installs.
 */
export class SqliteBackend implements Backend {
  readonly kind = 'sqlite' as const
  private readonly sql: DatabaseSync

  constructor(readonly label: string) {
    this.sql = new DatabaseSync(label)
  }

  async init(): Promise<Snapshot> {
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
    for (const table of TABLES) {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS ${table} (
          id TEXT PRIMARY KEY,
          seq REAL NOT NULL,
          data TEXT NOT NULL CHECK (json_valid(data))
        );
        CREATE INDEX IF NOT EXISTS ${table}_seq ON ${table} (seq);
      `)
    }
    const meta = Object.fromEntries(
      (
        this.sql.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[]
      ).map((r) => [r.key, r.value]),
    )
    const rows = Object.fromEntries(
      TABLES.map((table) => [
        table,
        this.sql
          .prepare(`SELECT id, seq, data FROM ${table} ORDER BY seq`)
          .all() as unknown as StoredRow[],
      ]),
    ) as Record<Table, StoredRow[]>
    return { meta, rows }
  }

  async apply(changes: Changes): Promise<void> {
    this.sql.exec('BEGIN')
    try {
      const setMeta = this.sql.prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      )
      for (const [key, value] of changes.meta) setMeta.run(key, value)
      for (const [table, rows] of Object.entries(changes.upserts) as [Table, StoredRow[]][]) {
        const upsert = this.sql.prepare(
          `INSERT INTO ${table} (id, seq, data) VALUES (?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
        )
        for (const r of rows) upsert.run(r.id, r.seq, r.data)
      }
      for (const [table, ids] of Object.entries(changes.deletes) as [Table, string[]][]) {
        const remove = this.sql.prepare(`DELETE FROM ${table} WHERE id = ?`)
        for (const id of ids) remove.run(id)
      }
      this.sql.exec('COMMIT')
    } catch (error) {
      this.sql.exec('ROLLBACK')
      throw error
    }
  }

  async addSms(sentAt: string, to: string, message: string): Promise<number> {
    const result = this.sql
      .prepare('INSERT INTO sms_outbox (sent_at, to_phone, message) VALUES (?, ?, ?)')
      .run(sentAt, to, message)
    return Number(result.lastInsertRowid)
  }

  async listSms(limit: number): Promise<SmsMessage[]> {
    return (
      this.sql
        .prepare('SELECT id, sent_at, to_phone, message FROM sms_outbox ORDER BY id DESC LIMIT ?')
        .all(limit) as { id: number; sent_at: string; to_phone: string; message: string }[]
    ).map((r) => ({ id: r.id, sentAt: r.sent_at, to: r.to_phone, message: r.message }))
  }

  async close(): Promise<void> {
    if (this.sql.isOpen) this.sql.close()
  }
}
