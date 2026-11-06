import { timingSafeEqual, type KeyObject } from 'node:crypto'
import { keysToCamel, keysToSnake } from '@/lib/case'
import { todayIso } from '@/lib/dates'
import { SubscriptionError, subscriptionErrorBody } from '@/mocks/platform'
import { openEmsServer, type EmsServer, type SystemStatus } from './index'
import { checkLicence } from './licence'
import { validateOnboarding } from './onboarding'
import type { SaasClient } from './saas'
import type { SmsProvider } from './sms'
import { Store, type SmsMessage } from './store'
import type { Backend } from './storage/types'
import { installBusinessScopes } from './tenancy'

/**
 * Several businesses on one EMS server: one process, one database.
 *
 * Each business has its own address (`ayo.ems.example.ng`, or its own domain),
 * its own tables (a PostgreSQL schema, or a SQLite file), its own licence, staff,
 * sign-in keys and SMS outbox. A request is answered by the business its address
 * belongs to, inside that business's scope (tenancy.ts), so no request can reach
 * another business's data.
 *
 * A business is loaded on its first request and unloaded after it has been idle
 * for a while, so the server only holds the businesses in use.
 *
 * The operator (Entacrest) adds, renames, suspends and licenses businesses
 * through /__platform/businesses, with the platform key.
 *
 * Hosted EMS (`saas`): SynchGate sells EMS and is the operator. Visitors sign up at
 * the bare address (<baseDomain>), which the hub passes to SynchGate; SynchGate then
 * adds the business here, already set up, with a licence for its trial. Each business
 * reaches its subscription through SynchGate too, and SynchGate sends a new licence
 * whenever it is paid for.
 */

export interface BusinessRecord {
  /** Lower-case letters, digits and dashes; also the first part of its address. */
  id: string
  name: string
  /** Other addresses that open this business, e.g. its own domain. */
  domains: string[]
  status: 'active' | 'suspended'
  createdAt: string
}

export interface HubOptions {
  /** Holds the list of businesses. */
  registry: Backend
  /** Where one business's data lives. */
  businessStorage: (id: string) => Backend
  /** Businesses answer at <id>.<baseDomain>, e.g. ayo.ems.example.ng. */
  baseDomain?: string | null
  /** Opens /__platform/; without it the operator API is off. */
  platformKey?: string | null
  /** Unload a business after this many idle minutes (default 30). */
  idleMinutes?: number
  sms?: SmsProvider
  onSms?: (business: string, sms: SmsMessage) => void
  /** For tests. */
  machineCode?: string
  licenceKey?: KeyObject
  now?: () => number
  /** Hosted EMS: sign-up and subscriptions through SynchGate (saas.ts). */
  saas?: SaasClient | null
}

const ID = /^[a-z][a-z0-9-]{1,30}$/
const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/
/** Addresses a business may not take. */
const RESERVED = new Set(['www', 'admin', 'api', 'app', 'platform', 'mail', 'ems', 'status'])

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(keysToSnake(body)), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/** A business's tables live in this PostgreSQL schema. */
export const businessSchema = (id: string) => `biz_${id.replace(/-/g, '_')}`

interface Loaded {
  server: Promise<EmsServer>
  /** Requests being answered now; never unloaded while above zero. */
  active: number
  lastUsed: number
  /** Saving failed: drop it and load it again from the database on the next request. */
  broken: boolean
}

export async function openHub(options: HubOptions) {
  installBusinessScopes()
  const now = options.now ?? Date.now
  const idleMs = (options.idleMinutes ?? 30) * 60_000
  const baseDomain = options.baseDomain?.toLowerCase().replace(/^\.+|\.+$/g, '') || null
  const registry = await Store.open(options.registry)
  let businesses: BusinessRecord[] = JSON.parse(registry.getMeta('businesses') ?? '[]')
  const loaded = new Map<string, Loaded>()

  async function saveRegistry() {
    registry.setMeta('businesses', JSON.stringify(businesses))
    await registry.flush()
  }

  /** The business that answers at this address, if any. */
  function businessAt(url: string): BusinessRecord | null {
    const host = new URL(url).hostname.toLowerCase()
    const sub = (suffix: string) =>
      host.endsWith(`.${suffix}`) ? host.slice(0, -suffix.length - 1) : null
    // <id>.localhost always works, for trying the hub on one computer.
    const id = (baseDomain && sub(baseDomain)) ?? sub('localhost')
    return businesses.find((b) => (id !== null && b.id === id) || b.domains.includes(host)) ?? null
  }

  function load(id: string): Loaded {
    let entry = loaded.get(id)
    if (entry?.broken) {
      loaded.delete(id)
      void entry.server.then((s) => s.close()).catch(() => undefined)
      entry = undefined
    }
    if (entry) return entry
    const fresh: Loaded = { server: null as never, active: 0, lastUsed: now(), broken: false }
    fresh.server = openEmsServer({
      storage: options.businessStorage(id),
      business: id,
      sms: options.sms,
      onSms: (m) => options.onSms?.(id, m),
      machineCode: options.machineCode,
      licenceKey: options.licenceKey,
      subscription: options.saas?.forBusiness(id) ?? null,
      onFatal: (error) => {
        console.error(`EMS business "${id}" stopped saving and will be reloaded.`, error)
        fresh.broken = true
      },
    })
    // A business that fails to open is tried again on its next request.
    fresh.server.catch(() => loaded.get(id) === fresh && loaded.delete(id))
    loaded.set(id, fresh)
    return fresh
  }

  /** Run `fn` with the business loaded, keeping it loaded until `fn` is done. */
  async function using<T>(id: string, fn: (server: EmsServer) => Promise<T>): Promise<T> {
    const entry = load(id)
    entry.active++
    try {
      return await fn(await entry.server)
    } finally {
      entry.active--
      entry.lastUsed = now()
    }
  }

  /** Unload businesses nobody has used for a while. */
  async function unloadIdle() {
    const cutoff = now() - idleMs
    for (const [id, entry] of loaded) {
      if (entry.active > 0 || entry.lastUsed > cutoff) continue
      loaded.delete(id)
      await entry.server.then((s) => s.close()).catch(() => undefined)
    }
  }
  const timer = setInterval(() => void unloadIdle(), Math.min(idleMs, 60_000))
  timer.unref?.()

  /** The bare address, where visitors sign up: <baseDomain>, www.<baseDomain> or localhost. */
  function isSignupAddress(url: string) {
    const host = new URL(url).hostname.toLowerCase()
    return (
      host === 'localhost' ||
      (!!baseDomain && (host === baseDomain || host === `www.${baseDomain}`))
    )
  }

  /** Sign-up, passed to SynchGate: /api/v1/signup/plans/, /signup/check/?slug=, POST /signup/. */
  async function signup(request: Request, saas: SaasClient): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname.replace(/^\/api\/v1/, '')
    try {
      if (path === '/signup/plans/' && request.method === 'GET') return json(await saas.plans())
      if (path === '/signup/check/' && request.method === 'GET')
        return json(await saas.checkSlug(url.searchParams.get('slug') ?? ''))
      if (path === '/signup/' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}))
        const tenant = await saas.signup(body, request.headers.get('x-forwarded-for'))
        const id = String(tenant.id ?? '')
        // The new business's address, on the same scheme and port as this page.
        const host = url.host.replace(/^www\./, '')
        return json({ ...tenant, address: `${url.protocol}//${id}.${host}/` }, 201)
      }
    } catch (error) {
      if (error instanceof SubscriptionError)
        return json(subscriptionErrorBody(error), error.status)
      throw error
    }
    return json({ detail: 'Not found.', code: 'not_found' }, 404)
  }

  /** Answer one API request for the business at the request's address. */
  async function handle(request: Request): Promise<Response> {
    const business = businessAt(request.url)
    if (!business && options.saas && isSignupAddress(request.url)) {
      if (new URL(request.url).pathname.startsWith('/api/v1/signup/'))
        return signup(request, options.saas)
      return json({ detail: 'Sign up for EMS at this address.', code: 'signup', signup: true }, 404)
    }
    if (!business)
      return json(
        { detail: 'There is no EMS business at this address.', code: 'unknown_business' },
        404,
      )
    if (business.status === 'suspended')
      return json(
        {
          detail: `EMS for ${business.name} is suspended. Contact Entacrest to restore it.`,
          code: 'business_suspended',
        },
        403,
      )
    return using(business.id, (server) => server.handle(request))
  }

  /** The SMS outbox of the business at the request's address. */
  async function listSms(limit: number, request: Request): Promise<SmsMessage[]> {
    const business = businessAt(request.url)
    return business ? using(business.id, (server) => server.listSms(limit)) : []
  }

  // ── Operator API: /__platform/businesses[/<id>] ─────────────────────────────

  function authorised(request: Request) {
    if (!options.platformKey) return false
    const given = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const a = Buffer.from(given)
    const b = Buffer.from(options.platformKey)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  const address = (b: BusinessRecord) => [
    ...(baseDomain ? [`${b.id}.${baseDomain}`] : []),
    ...b.domains,
  ]

  async function describe(b: BusinessRecord, withStatus: boolean) {
    let status: SystemStatus | null = null
    if (withStatus && b.status === 'active')
      status = await using(b.id, async (server) => server.status())
    return {
      ...b,
      addresses: address(b),
      loaded: loaded.has(b.id),
      ...(status && {
        businessName: status.businessName,
        onboarded: status.onboarded,
        licence: status.licence,
      }),
    }
  }

  /** Check a name, domains and status; returns field errors. */
  function check(next: Partial<BusinessRecord>, self: string | null) {
    const errors: Record<string, string[]> = {}
    if ('name' in next && !next.name?.trim()) errors.name = ['Enter the business name.']
    if ('domains' in next) {
      const list = next.domains ?? []
      const bad = list.filter((d) => !DOMAIN.test(d))
      const taken = list.filter((d) =>
        businesses.some((b) => b.id !== self && b.domains.includes(d)),
      )
      const own = baseDomain ? list.filter((d) => d.endsWith(`.${baseDomain}`)) : []
      if (bad.length) errors.domains = [`Not a domain: ${bad.join(', ')}.`]
      else if (taken.length)
        errors.domains = [`Already used by another business: ${taken.join(', ')}.`]
      else if (own.length)
        errors.domains = [
          `Addresses under ${baseDomain} come from the business id; don’t list them.`,
        ]
    }
    if ('status' in next && next.status !== 'active' && next.status !== 'suspended')
      errors.status = ['Use active or suspended.']
    return errors
  }

  const cleanDomains = (v: unknown) =>
    Array.isArray(v)
      ? [...new Set(v.map((d) => String(d).trim().toLowerCase()).filter(Boolean))]
      : []

  /** Save a licence code for a business; returns an error message, or null. */
  async function licenceFor(id: string, code: string): Promise<string | null> {
    const result = await using(id, async (server) => server.setLicence(code.replace(/\s+/g, '')))
    if (result.status === 'valid') return null
    if (result.status === 'invalid') return result.reason
    if (result.status === 'expired') return `This licence ended on ${result.licence.expires}.`
    return 'This licence is tied to one computer. Issue it without --machine.'
  }

  async function admin(request: Request): Promise<Response> {
    if (!authorised(request)) return json({ detail: 'Not found.', code: 'not_found' }, 404)
    const path = new URL(request.url).pathname.replace(/\/+$/, '')
    const match = /^\/__platform\/businesses(?:\/([a-z0-9-]+))?$/.exec(path)
    if (!match) return json({ detail: 'Not found.', code: 'not_found' }, 404)
    const id = match[1]
    const body = ['POST', 'PATCH'].includes(request.method)
      ? (keysToCamel(await request.json().catch(() => ({}))) as Record<string, unknown>)
      : {}

    if (!id && request.method === 'GET')
      return json({ results: await Promise.all(businesses.map((b) => describe(b, false))) })

    if (!id && request.method === 'POST') {
      const newId = String(body.id ?? '')
        .trim()
        .toLowerCase()
      const record: BusinessRecord = {
        id: newId,
        name: String(body.name ?? '').trim(),
        domains: cleanDomains(body.domains),
        status: 'active',
        createdAt: new Date(now()).toISOString(),
      }
      const errors = check(record, null)
      // Hosted sign-up: the business arrives set up, with its MD, and must have a licence
      // that works, so it never exists half-made.
      const setup = body.setup === undefined ? null : validateOnboarding(body.setup)
      if (setup) {
        for (const [key, messages] of Object.entries(setup.errors))
          errors[`setup.${key}`] = messages
        const code = typeof body.licence === 'string' ? body.licence.replace(/\s+/g, '') : ''
        const verdict = code
          ? checkLicence(code, options.machineCode ?? '', todayIso(), options.licenceKey)
          : null
        if (!verdict) errors.licence = ['A business that is set up needs a licence.']
        else if (verdict.status === 'invalid') errors.licence = [verdict.reason]
        else if (verdict.status !== 'valid')
          errors.licence = ['This licence has ended or is tied to one computer.']
      }
      if (!ID.test(newId))
        errors.id = ['Use 2–31 lower-case letters, digits or dashes, starting with a letter.']
      else if (RESERVED.has(newId)) errors.id = [`“${newId}” is reserved. Choose another id.`]
      else if (businesses.some((b) => b.id === newId))
        errors.id = ['A business already has this id.']
      if (Object.keys(errors).length) return json(errors, 400)
      businesses = [...businesses, record]
      await saveRegistry()
      const licenceError =
        typeof body.licence === 'string' && body.licence.trim()
          ? await licenceFor(record.id, body.licence)
          : null
      if (setup && !licenceError)
        await using(record.id, (server) => server.onboard({ ...setup.input, sampleData: false }))
      return json({ ...(await describe(record, true)), ...(licenceError && { licenceError }) }, 201)
    }

    const business = businesses.find((b) => b.id === id)
    if (!business) return json({ detail: 'No business has this id.', code: 'not_found' }, 404)

    if (request.method === 'GET') return json(await describe(business, true))

    if (request.method === 'PATCH') {
      const changes: Partial<BusinessRecord> = {}
      if ('name' in body) changes.name = String(body.name ?? '').trim()
      if ('domains' in body) changes.domains = cleanDomains(body.domains)
      if ('status' in body) changes.status = body.status as BusinessRecord['status']
      const errors = check(changes, business.id)
      if (typeof body.licence === 'string' && body.licence.trim() && business.status === 'active') {
        const problem = await licenceFor(business.id, body.licence)
        if (problem) errors.licence = [problem]
      }
      if (Object.keys(errors).length) return json(errors, 400)
      const updated = { ...business, ...changes }
      businesses = businesses.map((b) => (b.id === business.id ? updated : b))
      await saveRegistry()
      // A suspended business is unloaded at once.
      if (updated.status === 'suspended') {
        const entry = loaded.get(updated.id)
        if (entry && entry.active === 0) {
          loaded.delete(updated.id)
          await entry.server.then((s) => s.close()).catch(() => undefined)
        }
      }
      return json(await describe(updated, true))
    }

    return json({ detail: 'Method not allowed.', code: 'method_not_allowed' }, 405)
  }

  async function close() {
    clearInterval(timer)
    const entries = [...loaded.values()]
    loaded.clear()
    await Promise.all(entries.map((e) => e.server.then((s) => s.close()).catch(() => undefined)))
    await registry.close()
  }

  return {
    handle,
    listSms,
    admin,
    close,
    /** For tests and the operator: the businesses on this server. */
    businesses: () => businesses.map((b) => ({ ...b, addresses: address(b) })),
    loadedCount: () => loaded.size,
    unloadIdle,
  }
}

export type EmsHub = Awaited<ReturnType<typeof openHub>>
