import { randomBytes, type KeyObject } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getResponse } from 'msw'
import { keysToCamel, keysToSnake } from '@/lib/case'
import { todayIso } from '@/lib/dates'
import { attachStore, db } from '@/mocks/db'
import { handlers } from '@/mocks/handlers'
import { setPlatform } from '@/mocks/platform'
import { api } from '@/mocks/utils'
import { checkLicence, machineCode as readMachineCode, type LicenceCheck } from './licence'
import { initialData, validateOnboarding } from './onboarding'
import { livePlatform } from './platform'
import { Store, type SmsMessage } from './store'

/**
 * The EMS desktop server. It runs inside the Electron app and answers the same
 * /api/v1 endpoints the Django backend will, using the app's business rules
 * (src/mocks/handlers) with the data kept in SQLite.
 *
 * Until a valid licence is entered and the business is set up, only the
 * /system/ endpoints answer.
 */

export interface EmsServerOptions {
  /** Folder for ems.sqlite. */
  dataDir: string
  /** For tests; read from the computer otherwise. */
  machineCode?: string
  /** For tests: trust this key instead of the Entacrest key built into the app. */
  licenceKey?: KeyObject
  /** Called for every text message, e.g. to show it on screen. */
  onSms?: (sms: SmsMessage) => void
}

export interface SystemStatus {
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
}

const API = '/api/v1'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(keysToSnake(body)), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

export function createEmsServer(options: EmsServerOptions) {
  mkdirSync(options.dataDir, { recursive: true })
  const store = new Store(join(options.dataDir, 'ems.sqlite'))
  const machine = options.machineCode ?? readMachineCode()

  let secret = store.getMeta('token_secret')
  if (!secret) {
    secret = randomBytes(32).toString('base64url')
    store.setMeta('token_secret', secret)
  }

  const licenceCheck = (): LicenceCheck | null => {
    const code = store.getMeta('licence')
    return code ? checkLicence(code, machine, todayIso(), options.licenceKey) : null
  }

  setPlatform(
    livePlatform({
      secret,
      sendSms: (to, message) => options.onSms?.(store.addSms(to, message)),
      branchLimit: () => {
        const check = licenceCheck()
        return check && 'licence' in check ? check.licence.branches : null
      },
    }),
  )

  const saved = store.load()
  if (saved) attachStore(saved, (data) => store.save(data))
  let onboarded = saved !== null

  function status(): SystemStatus {
    const check = licenceCheck()
    return {
      licence: !check
        ? null
        : check.status === 'invalid'
          ? { status: 'invalid', reason: check.reason }
          : { status: check.status, ...check.licence },
      machineCode: machine,
      onboarded,
      businessName: onboarded ? db().settings.businessName : null,
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
      store.setMeta('licence', code)
      return json(status())
    }

    if (path === '/system/onboarding/' && request.method === 'POST') {
      if (licenceCheck()?.status !== 'valid')
        return json({ detail: 'Enter a valid licence first.', code: 'licence_required' }, 403)
      if (onboarded)
        return json(
          { detail: 'EMS is already set up on this computer.', code: 'already_set_up' },
          409,
        )
      const { errors, input } = validateOnboarding(
        keysToCamel(await request.json().catch(() => ({}))),
      )
      if (Object.keys(errors).length) return json(errors, 400)
      const data = initialData(input)
      store.save(data)
      attachStore(data, (next) => store.save(next))
      onboarded = true
      return json({ email: input.md.email, sampleData: input.sampleData }, 201)
    }

    return json({ detail: 'Not found.', code: 'not_found' }, 404)
  }

  /** Answer one API request. `url` is the path and query, e.g. /api/v1/customers/?page=2. */
  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname.slice(API.length)
    if (path.startsWith('/system/')) return system(path, request)
    if (licenceCheck()?.status !== 'valid' || !onboarded)
      return json(
        {
          detail: 'EMS needs a valid licence and set-up before it can be used.',
          code: 'licence_required',
        },
        403,
      )
    // The handlers match on their own base address (http://localhost/api/v1/ in the
    // app), whatever address the request came in on.
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
    const response = await getResponse(handlers, local)
    return response ?? json({ detail: 'Not found.', code: 'not_found' }, 404)
  }

  return {
    handle,
    status,
    machineCode: machine,
    listSms: (limit?: number) => store.listSms(limit),
    backup: (file: string) => store.backup(file),
    close: () => store.close(),
  }
}

export type EmsServer = ReturnType<typeof createEmsServer>
