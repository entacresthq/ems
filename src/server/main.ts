import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { openEmsServer, type EmsServer, type ServerMode } from './index'
import { createRequestListener } from './http'
import { smsProvider, type SmsProvider } from './sms'
import { SqliteBackend } from './storage/sqlite'
import { postgresBackend } from './storage/postgres'
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

function storage(): Backend {
  const url = env.DATABASE_URL
  if (url) {
    return postgresBackend(
      url,
      env.EMS_DB_SCHEMA ?? 'ems',
      readCa(env.DATABASE_CA_CERT),
      (error) => {
        console.error('Lost the database connection:', error)
        process.exit(1)
      },
    )
  }
  const dir = resolve(env.EMS_DATA_DIR ?? 'data')
  mkdirSync(dir, { recursive: true })
  return new SqliteBackend(join(dir, mode === 'demo' ? 'demo.sqlite' : 'ems.sqlite'))
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

  let ems: EmsServer
  const backend = storage()
  try {
    ems = await openEmsServer({
      storage: backend,
      mode,
      licenceFile: env.EMS_LICENCE_FILE,
      sms,
      onSms: (message) => parent?.postMessage({ type: 'sms', sms: message }),
      onFatal: () => setTimeout(() => process.exit(1), 100),
    })
  } catch (error) {
    fail((error as Error).message)
  }

  const outboxKey = env.EMS_OUTBOX_KEY
  const listener = createRequestListener({
    ems,
    webRoot,
    outbox:
      env.EMS_OUTBOX === 'open'
        ? { access: 'open' }
        : outboxKey
          ? { access: 'key', key: outboxKey }
          : { access: 'off' },
    trustProxy: env.EMS_TRUST_PROXY === 'true',
  })
  const server = createServer(listener)
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

  console.log(
    `EMS ${mode} server on http://${host}:${port} · data: ${ems.database} · SMS: ${sms.name}`,
  )
  parent?.postMessage({ type: 'ready', port })

  // Requests from the desktop app's main process.
  parent?.on('message', ({ data }) => {
    const message = data as { id: number; type: string; file?: string }
    const reply = (body: object) => parent.postMessage({ id: message.id, ...body })
    if (message.type === 'status') reply({ type: 'status', status: ems.status() })
    if (message.type === 'backup' && message.file)
      ems.backup(message.file).then(
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
    await ems.close().catch(() => undefined)
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())
}

void start()
