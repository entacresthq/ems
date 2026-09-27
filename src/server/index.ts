import { randomBytes, type KeyObject } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { getResponse } from 'msw'
import { keysToCamel, keysToSnake } from '@/lib/case'
import { todayIso } from '@/lib/dates'
import { attachStore, db } from '@/mocks/db'
import { DEMO_OTP } from '@/mocks/demoLogins'
import { handlers } from '@/mocks/handlers'
import { setPlatform } from '@/mocks/platform'
import { api } from '@/mocks/utils'
import { checkLicence, machineCode as readMachineCode, type LicenceCheck } from './licence'
import { demoData, initialData, validateOnboarding } from './onboarding'
import { livePlatform } from './platform'
import { smsProvider, type SmsProvider, type SmsProviderName } from './sms'
import { Store, type SmsMessage } from './store'
import type { Backend } from './storage/types'

export { copyDatabase } from './store'
export { SqliteBackend } from './storage/sqlite'
export { postgresBackend, DatabaseInUseError } from './storage/postgres'
export type { Backend } from './storage/types'

/**
 * The EMS server. It answers the same /api/v1 endpoints the Django backend
 * will, using the app's business rules (src/mocks/handlers), with the data in
 * SQLite or PostgreSQL (e.g. Supabase). It runs inside the desktop app, or on
 * its own for a web deployment (see main.ts).
 *
 * Until a valid licence is entered and the business is set up, only the
 * /system/ endpoints answer.
 */

export type ServerMode = 'live' | 'demo'

export interface EmsServerOptions {
  storage: Backend
  /** "demo": sample data for training, set up automatically, sign-in code 123456. */
  mode?: ServerMode
  /**
   * Keep the licence in this file instead of the database, so several servers
   * on one computer (the desktop's live and demo workspaces) share it.
   */
  licenceFile?: string
  /** For tests; read from the computer otherwise. */
  machineCode?: string
  /** For tests: trust this key instead of the Entacrest key built into the app. */
  licenceKey?: KeyObject
  /** Sends text messages; they are always kept in the outbox too. */
  sms?: SmsProvider
  /** Called for every text message, e.g. to show it on screen. */
  onSms?: (sms: SmsMessage) => void
  /** Called once if saving fails; the server then refuses further requests. */
  onFatal?: (error: Error) => void
}

export interface SystemStatus {
  mode: ServerMode
  licence:
    | ({ status: LicenceCheck['status'] } & Partial<{
        id: string
        licensee: string
        plan: string
        branches: number | null
        issued: string
        expires: string | null
        reason: string
      }>)
    | null
  machineCode: string
  onboarded: boolean
  businessName: string | null
  /** Where data is kept, and how texts are delivered. */
  database: Backend['kind']
  sms: SmsProviderName
}

const API = '/api/v1'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(keysToSnake(body)), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/** Licence code storage: the database, or a file shared between servers. */
function licenceStore(store: Store, file: string | undefined) {
  if (!file) {
    return {
      read: () => store.getMeta('licence'),
      write: (code: string) => store.setMeta('licence', code),
    }
  }
  // Older desktop installs kept the licence in the database.
  const inDb = store.getMeta('licence')
  if (inDb && !existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, inDb)
  }
  let cached: { code: string | null; mtime: number } = { code: null, mtime: -1 }
  return {
    read: () => {
      try {
        const mtime = statSync(file).mtimeMs
        if (mtime !== cached.mtime)
          cached = { code: readFileSync(file, 'utf8').trim() || null, mtime }
        return cached.code
      } catch {
        return null
      }
    },
    write: (code: string) => {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, code)
    },
  }
}

export async function openEmsServer(options: EmsServerOptions) {
  const mode = options.mode ?? 'live'
  const store = await Store.open(options.storage)
  const machine = options.machineCode ?? readMachineCode()
  const sms = options.sms ?? smsProvider({})
  const licence = licenceStore(store, options.licenceFile)
  let fatal: Error | null = null

  let secret = store.getMeta('token_secret')
  if (!secret) {
    secret = randomBytes(32).toString('base64url')
    store.setMeta('token_secret', secret)
  }

  const licenceCheck = (): LicenceCheck | null => {
    const code = licence.read()
    return code ? checkLicence(code, machine, todayIso(), options.licenceKey) : null
  }

  async function deliver(to: string, message: string) {
    const saved = await store.addSms(to, message)
    options.onSms?.(saved)
    try {
      await sms.send(to, message)
    } catch (error) {
      console.error(`SMS to ${to} not sent:`, error)
    }
  }

  setPlatform(
    livePlatform({
      secret,
      sendSms: (to, message) => void deliver(to, message).catch(() => undefined),
      branchLimit: () => {
        const check = licenceCheck()
        return check && 'licence' in check ? check.licence.branches : null
      },
      fixedOtp: mode === 'demo' ? DEMO_OTP : undefined,
      sessionCookie: mode === 'demo' ? 'ems_demo_refresh' : 'ems_refresh',
    }),
  )

  let data = store.load()
  // The demo workspace sets itself up with the training data.
  if (!data && mode === 'demo') {
    data = demoData()
    store.save(data)
  }
  if (data) attachStore(data, (next) => store.save(next))
  let onboarded = data !== null
  await store.flush()

  function status(): SystemStatus {
    const check = licenceCheck()
    return {
      mode,
      licence: !check
        ? null
        : check.status === 'invalid'
          ? { status: 'invalid', reason: check.reason }
          : { status: check.status, ...check.licence },
      machineCode: machine,
      onboarded,
      businessName: onboarded ? db().settings.businessName : null,
      database: options.storage.kind,
      sms: sms.name,
    }
  }

  async function system(path: string, request: Request): Promise<Response> {
    if (path === '/system/status/' && request.method === 'GET') return json(status())

    if (path === '/system/licence/' && request.method === 'POST') {
      const body = keysToCamel(await request.json().catch(() => ({}))) as { code?: unknown }
      const code = typeof body.code === 'string' ? body.code.replace(/\s+/g, '') : ''
      if (!code) return json({ code: ['Paste your licence code.'] }, 400)
      const check = checkLicence(code, machine, todayIso(), options.licenceKey)
      if (check.status === 'invalid') return json({ code: [check.reason] }, 400)
      if (check.status === 'wrong_machine')
        return json(
          {
            code: [
              `This licence is for another computer. Send Entacrest this computer’s code: ${machine}`,
            ],
          },
          400,
        )
      if (check.status === 'expired')
        return json(
          { code: [`This licence ended on ${check.licence.expires}. Contact Entacrest to renew.`] },
          400,
        )
      licence.write(code)
      return json(status())
    }

    if (path === '/system/onboarding/' && request.method === 'POST') {
      if (licenceCheck()?.status !== 'valid')
        return json({ detail: 'Enter a valid licence first.', code: 'licence_required' }, 403)
      if (onboarded) return json({ detail: 'EMS is already set up.', code: 'already_set_up' }, 409)
      const { errors, input } = validateOnboarding(
        keysToCamel(await request.json().catch(() => ({}))),
      )
      if (Object.keys(errors).length) return json(errors, 400)
      // Live data starts clean; training data has its own demo workspace.
      const fresh = initialData({ ...input, sampleData: false })
      store.save(fresh)
      attachStore(fresh, (next) => store.save(next))
      onboarded = true
      await store.flush()
      return json({ email: input.md.email, sampleData: false }, 201)
    }

    return json({ detail: 'Not found.', code: 'not_found' }, 404)
  }

  const unavailable = () =>
    json(
      {
        detail:
          'EMS can’t save changes right now, so it has stopped to protect your data. Restart EMS.',
        code: 'storage_unavailable',
      },
      503,
    )

  /** Answer one API request, e.g. GET http://…/api/v1/customers/?page=2. */
  async function handle(request: Request): Promise<Response> {
    if (fatal) return unavailable()
    const url = new URL(request.url)
    const path = url.pathname.slice(API.length)
    let response: Response
    if (path.startsWith('/system/')) response = await system(path, request)
    else if (licenceCheck()?.status !== 'valid' || !onboarded)
      response = json(
        {
          detail: 'EMS needs a valid licence and set-up before it can be used.',
          code: 'licence_required',
        },
        403,
      )
    else {
      // The handlers match on their own base address (http://localhost/api/v1/ in
      // the app), whatever address the request came in on.
      const local =
        url.origin + API + '/' === api('/')
          ? request
          : new Request(api(path) + url.search, {
              method: request.method,
              headers: request.headers,
              body: ['GET', 'HEAD'].includes(request.method)
                ? undefined
                : await request.arrayBuffer(),
            })
      response =
        (await getResponse(handlers, local)) ??
        json({ detail: 'Not found.', code: 'not_found' }, 404)
    }
    // Only reply once the change is saved.
    try {
      await store.flush()
    } catch (error) {
      fatal = error instanceof Error ? error : new Error(String(error))
      console.error('EMS stopped: saving failed.', fatal)
      options.onFatal?.(fatal)
      return unavailable()
    }
    return response
  }

  return {
    mode,
    handle,
    status,
    machineCode: machine,
    database: options.storage.label,
    listSms: (limit?: number) => store.listSms(limit),
    backup: (file: string) => store.backup(file, onboarded ? db() : null),
    close: () => store.close(),
  }
}

export type EmsServer = Awaited<ReturnType<typeof openEmsServer>>
