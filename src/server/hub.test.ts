import { PGlite } from '@electric-sql/pglite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { businessSchema, openHub, type EmsHub } from './hub'
import { SqliteBackend } from './index'
import { PostgresBackend, type SqlClient } from './storage/postgres'
import type { SmsMessage } from './store'
import { keys, licence, MACHINE, onboarding } from './testing'

const dir = mkdtempSync(join(tmpdir(), 'ems-hub-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const KEY = 'platform-key-for-tests-0123456789'
const sms: Record<string, SmsMessage[]> = {}
let clock = Date.parse('2026-10-24T09:00:00Z')

const start = () =>
  openHub({
    registry: new SqliteBackend(join(dir, 'platform.sqlite')),
    businessStorage: (id) => new SqliteBackend(join(dir, `${id}.sqlite`)),
    baseDomain: 'ems.example.ng',
    platformKey: KEY,
    idleMinutes: 30,
    machineCode: MACHINE,
    licenceKey: keys.publicKey,
    onSms: (business, m) => (sms[business] ??= []).push(m),
    now: () => clock,
  })

async function call(
  hub: EmsHub,
  host: string,
  method: string,
  path: string,
  body?: unknown,
  token?: string,
) {
  const res = await hub.handle(
    new Request(`https://${host}/api/v1${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  const text = await res.text()
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} }
}

async function admin(hub: EmsHub, method: string, path: string, body?: unknown, key = KEY) {
  const res = await hub.admin(
    new Request(`https://ems.example.ng/__platform/businesses${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

const sent = (business: string) => sms[business]?.length ?? 0

async function signIn(hub: EmsHub, host: string, business: string, email: string) {
  const before = sent(business)
  const login = await call(hub, host, 'POST', '/auth/login/', { email, password: 'Strong2026' })
  expect(login.status).toBe(200)
  await expect.poll(() => sent(business)).toBeGreaterThan(before)
  const code = /code is (\d{6})/.exec(sms[business]!.at(-1)!.message)![1]
  const verified = await call(hub, host, 'POST', '/auth/otp/verify/', {
    challenge_id: login.body.challenge_id,
    code,
  })
  expect(verified.status).toBe(200)
  return { token: verified.body.access as string, challenge: login.body.challenge_id, code }
}

const AYO = 'ayo.ems.example.ng'
const IFE = 'ife.ems.example.ng'

describe('several businesses on one server', () => {
  let hub: EmsHub

  it('answers only at the address of a business it holds', async () => {
    hub = await start()
    expect((await call(hub, AYO, 'GET', '/system/status/')).body.code).toBe('unknown_business')
    expect((await admin(hub, 'GET', '', undefined, 'wrong-key')).status).toBe(404)
  })

  it('lets the operator add businesses, each with its own licence', async () => {
    const bad = await admin(hub, 'POST', '', { id: 'Ayo Thrift', name: '' })
    expect(Object.keys(bad.body).sort()).toEqual(['id', 'name'])
    expect((await admin(hub, 'POST', '', { id: 'www', name: 'X' })).body.id).toBeDefined()

    const ayo = await admin(hub, 'POST', '', {
      id: 'ayo',
      name: 'Ayo Thrift Society',
      licence: licence({ licensee: 'Ayo Thrift Society', branches: 1 }),
    })
    expect(ayo.status).toBe(201)
    expect(ayo.body).toMatchObject({
      addresses: ['ayo.ems.example.ng'],
      onboarded: false,
      licence: { status: 'valid', branches: 1 },
    })
    const ife = await admin(hub, 'POST', '', {
      id: 'ife',
      name: 'Ife Cooperative',
      domains: ['ems.ifecoop.ng'],
    })
    expect(ife.body).toMatchObject({ addresses: [IFE, 'ems.ifecoop.ng'], licence: null })
    expect((await admin(hub, 'POST', '', { id: 'ayo', name: 'Again' })).body.id).toEqual([
      'A business already has this id.',
    ])
    const taken = await admin(hub, 'POST', '', {
      id: 'other',
      name: 'Other',
      domains: ['ems.ifecoop.ng'],
    })
    expect(taken.status).toBe(400)
  })

  it('keeps an unlicensed business locked, even to set-up', async () => {
    const status = await call(hub, IFE, 'GET', '/system/status/')
    expect(status.body).toMatchObject({ business: 'ife', licence: null, onboarded: false })
    expect((await call(hub, IFE, 'POST', '/system/onboarding/', onboarding)).status).toBe(403)
    // The operator can license it, or the client enters the code on the Activate screen.
    const licensed = await call(hub, IFE, 'POST', '/system/licence/', {
      code: licence({ licensee: 'Ife Cooperative', branches: 3 }),
    })
    expect(licensed.status).toBe(200)
  })

  it('sets each business up separately, with its own staff and data', async () => {
    expect((await call(hub, AYO, 'POST', '/system/onboarding/', onboarding)).status).toBe(201)
    const ifeSetup = {
      business: { ...onboarding.business, name: 'Ife Cooperative' },
      md: { ...onboarding.md, first_name: 'Ifeoluwa', email: 'md@ifecoop.ng' },
    }
    // Its own domain opens the same business as its ems.example.ng address.
    expect(
      (await call(hub, 'ems.ifecoop.ng', 'POST', '/system/onboarding/', ifeSetup)).status,
    ).toBe(201)

    expect((await call(hub, AYO, 'GET', '/system/status/')).body.business_name).toBe(
      'Ayo Thrift Society',
    )
    expect((await call(hub, IFE, 'GET', '/system/status/')).body.business_name).toBe(
      'Ife Cooperative',
    )

    // Ayo's MD doesn't exist at Ife.
    const wrong = await call(hub, IFE, 'POST', '/auth/login/', {
      email: 'ayo@ayothrift.ng',
      password: 'Strong2026',
    })
    expect(wrong.status).toBe(400)

    const ayo = await signIn(hub, AYO, 'ayo', 'ayo@ayothrift.ng')
    const ife = await signIn(hub, IFE, 'ife', 'md@ifecoop.ng')
    expect((await call(hub, AYO, 'GET', '/auth/me/', undefined, ayo.token)).body.first_name).toBe(
      'Ayo',
    )
    expect((await call(hub, IFE, 'GET', '/auth/me/', undefined, ife.token)).body.first_name).toBe(
      'Ifeoluwa',
    )
    // A token from one business is worthless at another.
    expect((await call(hub, IFE, 'GET', '/auth/me/', undefined, ayo.token)).status).toBe(401)

    const branch = {
      name: 'Ipaja',
      code: '01',
      address: '1 Ipaja Road',
      phone: '0803 111 4444',
      areas: ['Ipaja Market'],
      manager_id: null,
      status: 'active',
    }
    expect((await call(hub, AYO, 'POST', '/branches/', branch, ayo.token)).status).toBe(201)
    // Each licence sets its own branch limit: Ayo's allows one.
    const second = { ...branch, name: 'Ayobo', code: '02' }
    expect((await call(hub, AYO, 'POST', '/branches/', second, ayo.token)).body.code).toBe(
      'licence_limit',
    )
    expect((await call(hub, IFE, 'POST', '/branches/', second, ife.token)).status).toBe(201)

    const names = async (host: string, token: string) =>
      (
        (await call(hub, host, 'GET', '/branches/', undefined, token)).body.results as {
          name: string
        }[]
      )
        .map((b) => b.name)
        .sort()
    expect(await names(AYO, ayo.token)).toEqual(['Headquarters', 'Ipaja'])
    expect(await names(IFE, ife.token)).toEqual(['Ayobo', 'Headquarters'])
  })

  it('refuses a sign-in code at another business', async () => {
    const before = sent('ayo')
    const login = await call(hub, AYO, 'POST', '/auth/login/', {
      email: 'ayo@ayothrift.ng',
      password: 'Strong2026',
    })
    await expect.poll(() => sent('ayo')).toBeGreaterThan(before)
    const code = /code is (\d{6})/.exec(sms.ayo!.at(-1)!.message)![1]
    const elsewhere = await call(hub, IFE, 'POST', '/auth/otp/verify/', {
      challenge_id: login.body.challenge_id,
      code,
    })
    expect(elsewhere.body.code).toBe('otp_expired')
  })

  it('shows each business only its own SMS outbox', async () => {
    const ayo = await hub.listSms(50, new Request(`https://${AYO}/__sms.json`))
    const ife = await hub.listSms(50, new Request(`https://${IFE}/__sms.json`))
    expect(ayo.length).toBe(sms.ayo!.length)
    expect(ife.length).toBe(sms.ife!.length)
    expect(ayo.every((m) => sms.ayo!.some((s) => s.message === m.message))).toBe(true)
    expect(await hub.listSms(50, new Request('https://nobody.ems.example.ng/__sms.json'))).toEqual(
      [],
    )
  })

  it('suspends and restores a business', async () => {
    const suspended = await admin(hub, 'PATCH', '/ayo', { status: 'suspended' })
    expect(suspended.body.status).toBe('suspended')
    expect((await call(hub, AYO, 'GET', '/system/status/')).body.code).toBe('business_suspended')
    // The other business carries on.
    expect((await call(hub, IFE, 'GET', '/system/status/')).status).toBe(200)
    await admin(hub, 'PATCH', '/ayo', { status: 'active' })
    expect((await call(hub, AYO, 'GET', '/system/status/')).body.onboarded).toBe(true)
  })

  it('unloads idle businesses and reloads them with their data, also after a restart', async () => {
    expect(hub.loadedCount()).toBe(2)
    clock += 31 * 60_000
    await hub.unloadIdle()
    expect(hub.loadedCount()).toBe(0)

    const again = await signIn(hub, AYO, 'ayo', 'ayo@ayothrift.ng')
    expect(hub.loadedCount()).toBe(1)
    const branches = await call(hub, AYO, 'GET', '/branches/', undefined, again.token)
    expect((branches.body.results as unknown[]).length).toBe(2)

    await hub.close()
    hub = await start()
    expect(hub.businesses().map((b) => b.id)).toEqual(['ayo', 'ife'])
    const list = await admin(hub, 'GET', '')
    expect((list.body.results as { id: string; loaded: boolean }[]).map((b) => b.loaded)).toEqual([
      false,
      false,
    ])
    const ife = await signIn(hub, IFE, 'ife', 'md@ifecoop.ng')
    expect((await call(hub, IFE, 'GET', '/auth/me/', undefined, ife.token)).status).toBe(200)
    await hub.close()
  })
})

describe('several businesses on one PostgreSQL database', () => {
  it('gives each business its own schema', async () => {
    const pg = new PGlite()
    const client = async () => pg as unknown as SqlClient
    const hub = await openHub({
      registry: new PostgresBackend('pglite', 'ems_platform', client),
      businessStorage: (id) => new PostgresBackend('pglite', businessSchema(id), client),
      baseDomain: 'ems.example.ng',
      platformKey: KEY,
      machineCode: MACHINE,
      licenceKey: keys.publicKey,
    })
    for (const id of ['ayo', 'ife-coop'])
      expect((await admin(hub, 'POST', '', { id, name: id, licence: licence() })).status).toBe(201)
    expect((await call(hub, AYO, 'POST', '/system/onboarding/', onboarding)).status).toBe(201)

    const schemas = await pg.query<{ schema_name: string }>(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'biz_%' OR schema_name = 'ems_platform' ORDER BY 1",
    )
    expect(schemas.rows.map((r) => r.schema_name)).toEqual([
      'biz_ayo',
      'biz_ife_coop',
      'ems_platform',
    ])
    const staff = async (schema: string) =>
      (await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${schema}".staff`)).rows[0]!.n
    expect(await staff('biz_ayo')).toBe(1)
    expect(await staff('biz_ife_coop')).toBe(0)
    await hub.close()
  })
})
