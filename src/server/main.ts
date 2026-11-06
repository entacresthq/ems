import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { createServer, type RequestListener } from 'node:http'
import { join, resolve } from 'node:path'
import { openEmsServer, type EmsServer, type ServerMode } from './index'
import { createRequestListener } from './http'
import { businessSchema, openHub } from './hub'
import { saasClient } from './saas'
import { smsProvider, type SmsProvider } from './sms'
import { SqliteBackend } from './storage/sqlite'
import { DatabaseInUseError, postgresBackend } from './storage/postgres'
import type { Backend } from './storage/types'

/**
 * Runs the EMS server on its own: `node build/server/main.cjs`. Used by web
 * deployments, and by the desktop app, which starts one per workspace (live and
 * demo) and talks to it over process.parentPort.
 *
 * Settings come from environment variables; see README → "Deploying EMS".
 */

interface ParentPort {
  postMessage(message: unknown): void
  on(event: 'message', listener: (event: { data: unknown }) => void): void
}
const parent = (process as unknown as { parentPort?: ParentPort }).parentPort

const env = process.env
const mode: ServerMode = env.EMS_MODE === 'demo' ? 'demo' : 'live'

function fail(message: string): never {
  console.error(`\nEMS can't start: ${message}\n`)
  parent?.postMessage({ type: 'failed', message })
  process.exit(1)
}

function readCa(value: string | undefined) {
  if (!value) return undefined
  return value.includes('BEGIN CERTIFICATE') ? value : readFileSync(value, 'utf8')
}

/** EMS_MULTI_BUSINESS=true: several businesses on this server, told apart by address (hub.ts). */
const multi = env.EMS_MULTI_BUSINESS === 'true'

/**
 * Where data is kept: PostgreSQL schema `schema` when DATABASE_URL is set,
 * otherwise the SQLite file `file` in EMS_DATA_DIR.
 */
function backend(schema: string, file: string, onLost: (error: Error) => void): Backend {
  const url = env.DATABASE_URL
  if (url) return postgresBackend(url, schema, readCa(env.DATABASE_CA_CERT), onLost)
  const dir = resolve(env.EMS_DATA_DIR ?? 'data')
  mkdirSync(join(dir, file, '..'), { recursive: true })
  return new SqliteBackend(join(dir, file))
}

const exitOnLost = (error: Error) => {
  console.error('Lost the database connection:', error)
  process.exit(1)
}

function storage(): Backend {
  return backend(
    env.EMS_DB_SCHEMA ?? 'ems',
    mode === 'demo' ? 'demo.sqlite' : 'ems.sqlite',
    exitOnLost,
  )
}

async function listen(server: ReturnType<typeof createServer>, port: number, host: string) {
  return new Promise<number>((done, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      const address = server.address()
      done(typeof address === 'object' && address ? address.port : port)
    })
  })
}

async function start() {
  const webRoot = resolve(env.EMS_WEB_ROOT ?? 'dist-web')
  if (!existsSync(join(webRoot, 'index.html')))
    fail(`the web app isn't built at ${webRoot}. Run npm run web:build, or set EMS_WEB_ROOT.`)

  let sms: SmsProvider
  try {
    sms = smsProvider(env)
  } catch (error) {
    fail((error as Error).message)
  }

  const outboxKey = env.EMS_OUTBOX_KEY
  const outbox =
    env.EMS_OUTBOX === 'open'
      ? ({ access: 'open' } as const)
      : env.EMS_OUTBOX === 'local'
        ? ({ access: 'local' } as const)
        : outboxKey
          ? ({ access: 'key', key: outboxKey } as const)
          : ({ access: 'off' } as const)

  // Until the data is loaded, only the health check answers.
  let listener: RequestListener = (req, res) => {
    if (req.url === '/healthz') return void res.writeHead(200).end('ok')
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '5' })
    res.end('EMS is starting. Try again in a moment.')
  }
  const server = createServer((req, res) => listener(req, res))
  const host = env.EMS_HOST ?? '0.0.0.0'
  const wanted = Number(env.PORT ?? env.EMS_PORT ?? 8080)
  let port: number
  try {
    port = await listen(server, wanted, host)
  } catch (error) {
    // The desktop app can run on another port if its usual one is taken.
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE' && env.EMS_PORT_FALLBACK === 'true')
      port = await listen(server, 0, host)
    else fail(`port ${wanted} is in use.`)
  }

  if (multi) {
    listener = await startHub(server, host, port, webRoot, sms, outbox)
    return
  }

  // Hosts such as Render start the new version before stopping the old one, which
  // still holds the database. With EMS_WAIT_FOR_LOCK the new one waits its turn.
  const waitForLock = env.EMS_WAIT_FOR_LOCK === 'true'
  let ems: EmsServer | undefined
  while (!ems) {
    try {
      ems = await openEmsServer({
        storage: storage(),
        mode,
        licenceFile: env.EMS_LICENCE_FILE,
        sms,
        onSms: (message) => parent?.postMessage({ type: 'sms', sms: message }),
        onFatal: () => setTimeout(() => process.exit(1), 100),
      })
    } catch (error) {
      if (waitForLock && error instanceof DatabaseInUseError) {
        console.log('Waiting for the previous EMS server to release the database…')
        await new Promise((r) => setTimeout(r, 5000))
      } else fail((error as Error).message)
    }
  }
  const running = ems
  listener = createRequestListener({
    ems: running,
    webRoot,
    outbox,
    trustProxy: env.EMS_TRUST_PROXY === 'true',
  })

  console.log(
    `EMS ${mode} server on http://${host}:${port} · data: ${running.database} · SMS: ${sms.name}`,
  )
  parent?.postMessage({ type: 'ready', port })

  // Requests from the desktop app's main process.
  parent?.on('message', ({ data }) => {
    const message = data as { id: number; type: string; file?: string }
    const reply = (body: object) => parent.postMessage({ id: message.id, ...body })
    if (message.type === 'status') reply({ type: 'status', status: running.status() })
    if (message.type === 'backup' && message.file)
      running.backup(message.file).then(
        () => reply({ type: 'done' }),
        (error: Error) => reply({ type: 'error', message: error.message }),
      )
    if (message.type === 'shutdown') void shutdown()
  })

  let closing = false
  async function shutdown() {
    if (closing) return
    closing = true
    server.close()
    await running.close().catch(() => undefined)
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())
}

/** Several businesses on this server (EMS_MULTI_BUSINESS=true). */
async function startHub(
  server: ReturnType<typeof createServer>,
  host: string,
  port: number,
  webRoot: string,
  sms: SmsProvider,
  outbox: Parameters<typeof createRequestListener>[0]['outbox'],
): Promise<RequestListener> {
  if (mode === 'demo')
    fail('EMS_MODE=demo runs one business. Leave it out with EMS_MULTI_BUSINESS.')
  const platformKey = env.EMS_PLATFORM_KEY ?? null
  if (!platformKey || platformKey.length < 24)
    fail('set EMS_PLATFORM_KEY to a long random secret (24+ characters). It opens /__platform/.')
  // Hosted EMS: sign-up and subscriptions through SynchGate.
  const saasUrl = env.EMS_SAAS_URL ?? null
  const saasKey = env.EMS_SAAS_KEY ?? null
  if (saasUrl && (!saasKey || saasKey.length < 24))
    fail(
      'set EMS_SAAS_KEY to SynchGate’s EMS_SERVICE_KEY (24+ characters), or leave out EMS_SAAS_URL.',
    )
  const saas = saasUrl && saasKey ? saasClient({ url: saasUrl, key: saasKey }) : null
  const waitForLock = env.EMS_WAIT_FOR_LOCK === 'true'
  let hub: Awaited<ReturnType<typeof openHub>> | undefined
  while (!hub) {
    try {
      hub = await openHub({
        registry: backend('ems_platform', 'platform.sqlite', exitOnLost),
        // One lost business connection reloads that business, not the whole server.
        businessStorage: (id) =>
          backend(businessSchema(id), join('businesses', `${id}.sqlite`), (error) =>
            console.error(`Lost the database connection for business "${id}":`, error),
          ),
        baseDomain: env.EMS_BASE_DOMAIN ?? null,
        platformKey,
        idleMinutes: env.EMS_IDLE_MINUTES ? Number(env.EMS_IDLE_MINUTES) : undefined,
        sms,
        saas,
      })
    } catch (error) {
      if (waitForLock && error instanceof DatabaseInUseError) {
        console.log('Waiting for the previous EMS server to release the database…')
        await new Promise((r) => setTimeout(r, 5000))
      } else fail((error as Error).message)
    }
  }
  const running = hub
  console.log(
    `EMS multi-business server on http://${host}:${port} · ${running.businesses().length} businesses · ` +
      `addresses: <id>.${env.EMS_BASE_DOMAIN ?? 'localhost'} · data: ${env.DATABASE_URL ? 'PostgreSQL' : 'SQLite'} · SMS: ${sms.name}` +
      (saas ? ` · hosted: sign-up and billing through ${saasUrl}` : ''),
  )
  let closing = false
  async function shutdown() {
    if (closing) return
    closing = true
    server.close()
    await running.close().catch(() => undefined)
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())
  return createRequestListener({
    ems: running,
    webRoot,
    outbox,
    trustProxy: env.EMS_TRUST_PROXY === 'true',
  })
}

void start()
