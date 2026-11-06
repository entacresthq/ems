import { randomBytes, type KeyObject } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { getResponse } from 'msw'
import { keysToCamel, keysToSnake } from '@/lib/case'
import { todayIso } from '@/lib/dates'
import { attachStore } from '@/mocks/db'
import { DEMO_OTP } from '@/mocks/demoLogins'
import { handlers } from '@/mocks/handlers'
import {
  ORIGIN_HEADER,
  setPlatform,
  SubscriptionError,
  subscriptionErrorBody,
  type SubscriptionGateway,
} from '@/mocks/platform'
import { api } from '@/mocks/utils'
import type { MockDb } from '@/mocks/seed/generate'
import { checkLicence, machineCode as readMachineCode, type LicenceCheck } from './licence'
import { demoData, initialData, validateOnboarding, type OnboardingInput } from './onboarding'
import { livePlatform } from './platform'
import { smsProvider, type SmsProvider, type SmsProviderName } from './sms'
import { Store, type SmsMessage } from './store'
import type { Backend } from './storage/types'
import { inBusiness, type BusinessScope } from './tenancy'

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
  /**
   * Set when this is one of several businesses on one server (hub.ts): its id.
   * The server then keeps its data and platform to itself and answers each
   * request inside the business's scope, instead of setting them for the process.
   */
  business?: string
  /** Hosted EMS: the business's subscription with SynchGate (saas.ts). */
  subscription?: SubscriptionGateway | null
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
  /** Which business this is, when one server holds several; null otherwise. */
  business: string | null
  onboarded: boolean
  businessName: string | null
  /** Where data is kept, and how texts are delivered. */
  database: Backend['kind']
  sms: SmsProviderName
  /** Hosted EMS: the licence comes from a subscription, renewed by paying, not by a code. */
  subscription: boolean
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
  const business = options.business ?? null
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

  const live = livePlatform({
    secret,
    sendSms: (to, message) => void deliver(to, message).catch(() => undefined),
    branchLimit: () => {
      const check = licenceCheck()
      return check && 'licence' in check ? check.licence.branches : null
    },
    fixedOtp: mode === 'demo' ? DEMO_OTP : undefined,
    sessionCookie: mode === 'demo' ? 'ems_demo_refresh' : 'ems_refresh',
    business,
    subscription: options.subscription ?? null,
  })
  if (!business) setPlatform(live)

  let data: MockDb | null = null
  const save = (next: MockDb) => store.save(next)
  /** The business's data from now on. A lone server shares it with the whole process. */
  function setData(next: MockDb) {
    data = next
    if (!business) attachStore(next, save)
  }
  const scope: BusinessScope = { data: () => data, save, platform: live }
  /** Run as this business: its own scope on a shared server, the process otherwise. */
  const within = <T>(fn: () => T): T => (business ? inBusiness(scope, fn) : fn())

  let loaded = store.load()
  // The demo workspace sets itself up with the training data.
  if (!loaded && mode === 'demo') {
    loaded = demoData()
    store.save(loaded)
  }
  if (loaded) setData(loaded)
  let onboarded = loaded !== null
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
      business,
      onboarded,
      businessName: data?.settings.businessName ?? null,
      database: options.storage.kind,
      sms: sms.name,
      subscription: Boolean(options.subscription),
    }
  }

  /** The business, its headquarters and the MD's account: the first-run set-up. */
  async function onboard(input: OnboardingInput) {
    // Live data starts clean; training data has its own demo workspace.
    const fresh = within(() => initialData({ ...input, sampleData: false }))
    store.save(fresh)
    setData(fresh)
    onboarded = true
    await store.flush()
  }

  /** Hosted EMS: renewing from the lock screen, and coming back from checkout. */
  async function subscription(path: string, request: Request): Promise<Response> {
    const gateway = options.subscription
    if (!gateway) return json({ detail: 'Not found.', code: 'not_found' }, 404)
    const body = keysToCamel(await request.json().catch(() => ({}))) as { reference?: unknown }
    try {
      if (path === '/system/subscription/renew/') {
        const origin = new URL(request.url).origin
        return json(await gateway.renew(`${origin}/subscription/return`), 201)
      }
      const reference = typeof body.reference === 'string' ? body.reference.trim() : ''
      if (!reference) return json({ reference: ['The payment reference is missing.'] }, 400)
      const result = await gateway.verify(reference)
      if (result.licence) {
        const check = setLicence(result.licence)
        if (check.status !== 'valid') console.error('SynchGate sent a licence EMS refused:', check)
      }
      return json({ payment: result.payment, status: status() })
    } catch (error) {
      if (error instanceof SubscriptionError)
        return json(subscriptionErrorBody(error), error.status)
      throw error
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
      await onboard(input)
      return json({ email: input.md.email, sampleData: false }, 201)
    }

    if (
      request.method === 'POST' &&
      (path === '/system/subscription/renew/' || path === '/system/subscription/verify/')
    )
      return subscription(path, request)

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
  const handle = (request: Request): Promise<Response> => within(() => answer(request))

  async function answer(request: Request): Promise<Response> {
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
      // the app), whatever address the request came in on. They learn the real one from
      // X-EMS-Origin, e.g. for links back to EMS; a client can't set it.
      const headers = new Headers(request.headers)
      headers.set(ORIGIN_HEADER, url.origin)
      const local = new Request(api(path) + url.search, {
        method: request.method,
        headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
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

  /** Save a licence code without going through the Activate screen (the hub's operator tools). */
  function setLicence(code: string): LicenceCheck {
    const check = checkLicence(code, machine, todayIso(), options.licenceKey)
    if (check.status === 'valid') licence.write(code)
    return check
  }

  return {
    mode,
    handle,
    status,
    setLicence,
    /** Set the business up without the Set up screen (hosted sign-up, through the hub). */
    onboard: async (input: OnboardingInput): Promise<boolean> => {
      if (onboarded) return false
      await onboard(input)
      return true
    },
    machineCode: machine,
    database: options.storage.label,
    listSms: (limit?: number) => store.listSms(limit),
    backup: (file: string) => store.backup(file, onboarded ? data : null),
    close: () => store.close(),
  }
}

export type EmsServer = Awaited<ReturnType<typeof openEmsServer>>
