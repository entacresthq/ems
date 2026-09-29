import {
  TABLES,
  type Backend,
  type Changes,
  type SmsMessage,
  type Snapshot,
  type StoredRow,
  type Table,
} from './types'

/** The part of a Postgres client EMS uses. `pg.Client` and PGlite (tests) both fit. */
export interface SqlClient {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>
}

export class DatabaseInUseError extends Error {
  constructor(label: string) {
    super(
      `Another EMS server is already using this database (${label}). Only one EMS server may use a database at a time: point other computers at that server instead of at the database.`,
    )
    this.name = 'DatabaseInUseError'
  }
}

const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,40}$/

/**
 * PostgreSQL, for example a Supabase project. Tables live in their own schema
 * (default "ems"), which Supabase doesn't publish through its REST API, and have
 * row-level security switched on with no policies, so only the EMS server's
 * database user can read them.
 *
 * The server holds a Postgres advisory lock for as long as it runs, so a second
 * EMS server pointed at the same database refuses to start instead of
 * overwriting the first one's work.
 */
export class PostgresBackend implements Backend {
  readonly kind = 'postgres' as const
  private client: SqlClient | null = null

  constructor(
    readonly label: string,
    private readonly schema: string,
    private readonly connect: () => Promise<SqlClient>,
    private readonly disconnect: (client: SqlClient) => Promise<void> = async () => undefined,
  ) {
    if (!SCHEMA_NAME.test(schema))
      throw new Error(
        `"${schema}" can't be used as a schema name. Use lowercase letters, numbers and _.`,
      )
  }

  private get db(): SqlClient {
    if (!this.client) throw new Error('The database connection is closed.')
    return this.client
  }

  private t(table: string) {
    return `"${this.schema}"."${table}"`
  }

  async init(): Promise<Snapshot> {
    this.client = await this.connect()
    const lock = await this.db.query<{ ok: boolean }>(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS ok',
      [`ems:${this.schema}`],
    )
    if (!lock.rows[0]?.ok) {
      await this.close()
      throw new DatabaseInUseError(this.label)
    }

    const ddl = [
      `CREATE SCHEMA IF NOT EXISTS "${this.schema}"`,
      `CREATE TABLE IF NOT EXISTS ${this.t('meta')} (key text PRIMARY KEY, value text NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS ${this.t('sms_outbox')} (
         id bigserial PRIMARY KEY,
         sent_at timestamptz NOT NULL,
         to_phone text NOT NULL,
         message text NOT NULL
       )`,
      ...TABLES.flatMap((table) => [
        `CREATE TABLE IF NOT EXISTS ${this.t(table)} (
           id text PRIMARY KEY,
           seq double precision NOT NULL,
           data jsonb NOT NULL
         )`,
        `CREATE INDEX IF NOT EXISTS "${table}_seq" ON ${this.t(table)} (seq)`,
      ]),
      ...['meta', 'sms_outbox', ...TABLES].map(
        (table) => `ALTER TABLE ${this.t(table)} ENABLE ROW LEVEL SECURITY`,
      ),
    ]
    for (const statement of ddl) await this.db.query(statement)

    const meta = Object.fromEntries(
      (
        await this.db.query<{ key: string; value: string }>(
          `SELECT key, value FROM ${this.t('meta')}`,
        )
      ).rows.map((r) => [r.key, r.value]),
    )
    const rows = {} as Record<Table, StoredRow[]>
    for (const table of TABLES) {
      const result = await this.db.query<{ id: string; seq: number; data: string }>(
        `SELECT id, seq, data::text AS data FROM ${this.t(table)} ORDER BY seq`,
      )
      rows[table] = result.rows.map((r) => ({ id: r.id, seq: Number(r.seq), data: r.data }))
    }
    return { meta, rows }
  }

  async apply(changes: Changes): Promise<void> {
    await this.db.query('BEGIN')
    try {
      if (changes.meta.length) {
        await this.db.query(
          `INSERT INTO ${this.t('meta')} (key, value)
           SELECT * FROM unnest($1::text[], $2::text[])
           ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
          [changes.meta.map(([k]) => k), changes.meta.map(([, v]) => v)],
        )
      }
      for (const [table, rows] of Object.entries(changes.upserts) as [Table, StoredRow[]][]) {
        if (!rows.length) continue
        // One statement per table, however many rows changed.
        await this.db.query(
          `INSERT INTO ${this.t(table)} (id, seq, data)
           SELECT * FROM unnest($1::text[], $2::float8[], $3::jsonb[])
           ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
          [rows.map((r) => r.id), rows.map((r) => r.seq), rows.map((r) => r.data)],
        )
      }
      for (const [table, ids] of Object.entries(changes.deletes) as [Table, string[]][]) {
        if (!ids.length) continue
        await this.db.query(`DELETE FROM ${this.t(table)} WHERE id = ANY($1::text[])`, [ids])
      }
      await this.db.query('COMMIT')
    } catch (error) {
      await this.db.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  }

  async addSms(sentAt: string, to: string, message: string): Promise<number> {
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO ${this.t('sms_outbox')} (sent_at, to_phone, message) VALUES ($1, $2, $3) RETURNING id`,
      [sentAt, to, message],
    )
    return Number(result.rows[0]!.id)
  }

  async listSms(limit: number): Promise<SmsMessage[]> {
    const result = await this.db.query<{
      id: string
      sent_at: Date | string
      to_phone: string
      message: string
    }>(
      `SELECT id, sent_at, to_phone, message FROM ${this.t('sms_outbox')} ORDER BY id DESC LIMIT $1`,
      [limit],
    )
    return result.rows.map((r) => ({
      id: Number(r.id),
      sentAt: new Date(r.sent_at).toISOString(),
      to: r.to_phone,
      message: r.message,
    }))
  }

  async close(): Promise<void> {
    const client = this.client
    this.client = null
    if (client) await this.disconnect(client)
  }
}

/**
 * Connect with node-postgres. Supabase needs TLS: pass its CA certificate
 * (Project Settings → Database → SSL) as `ca` to verify the server; without it
 * the connection is still encrypted but the certificate isn't checked.
 */
export async function connectPg(
  url: string,
  ca?: string,
): Promise<SqlClient & { end(): Promise<void> }> {
  const { Client } = await import('pg')
  const { hostname, searchParams } = new URL(url)
  const local = ['localhost', '127.0.0.1', '::1'].includes(hostname)
  const ssl =
    searchParams.get('sslmode') === 'disable' || local
      ? false
      : ca
        ? { ca, rejectUnauthorized: true }
        : { rejectUnauthorized: false }
  // sslmode in the URL would override the ssl option above; it's handled here instead.
  const cleaned = new URL(url)
  cleaned.searchParams.delete('sslmode')
  const client = new Client({
    connectionString: cleaned.toString(),
    ssl,
    application_name: 'ems-server',
    // Give up on an unreachable address instead of waiting indefinitely.
    connectionTimeoutMillis: 15_000,
  })
  try {
    await client.connect()
  } catch (error) {
    await client.end().catch(() => undefined)
    throw new Error(explainConnectionError(error as NodeJS.ErrnoException, hostname))
  }
  return client as unknown as SqlClient & { end(): Promise<void> }
}

/** Turn driver errors into something a person setting up EMS can act on. */
export function explainConnectionError(error: NodeJS.ErrnoException, host: string): string {
  const message = String(error.message ?? error)
  if (/password authentication failed/i.test(message))
    return 'The database password is wrong. Check the password in the connection string, or reset it in Supabase (Database → Settings).'
  // The direct address has only an IPv6 record, so on IPv4 networks it fails in several ways.
  if (
    /^db\.[a-z0-9]+\.supabase\.co$/.test(host) ||
    error.code === 'ENETUNREACH' ||
    error.code === 'EHOSTUNREACH'
  )
    return `Can’t reach "${host}". Supabase’s direct connection needs IPv6, which most networks don’t have: use the Session pooler connection string (…pooler.supabase.com:5432) instead.`
  if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN')
    return `Can’t find the database server "${host}". Check the address, and that this computer is online.`
  if (/timeout/i.test(message) || error.code === 'ETIMEDOUT')
    return `The database at "${host}" didn’t answer within 15 seconds. Check the address and your internet connection.`
  if (/tenant or user not found/i.test(message))
    return 'Supabase doesn’t recognise that user. In the Session pooler string the user looks like postgres.<project id>; copy it again from Connect.'
  return message
}

/** A Postgres backend for a connection string such as Supabase's session pooler URL. */
export function postgresBackend(
  url: string,
  schema = 'ems',
  ca?: string,
  onError?: (e: Error) => void,
) {
  const host = (() => {
    try {
      return new URL(url).hostname
    } catch {
      throw new Error('The database address isn’t a valid postgresql:// connection string.')
    }
  })()
  return new PostgresBackend(
    `${host}, schema ${schema}`,
    schema,
    async () => {
      const client = await connectPg(url, ca)
      // A lost connection also loses the advisory lock; stop rather than risk two writers.
      ;(client as unknown as { on(e: 'error', f: (err: Error) => void): void }).on('error', (err) =>
        onError?.(err),
      )
      return client
    },
    async (client) => (client as unknown as { end(): Promise<void> }).end(),
  )
}
