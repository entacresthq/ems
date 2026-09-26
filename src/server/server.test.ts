import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'
import { createEmsServer, type EmsServer } from './index'
import type { SmsMessage } from './store'

const MACHINE = 'AAAA-BBBB-CCCC-DDDD'
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const dir = mkdtempSync(join(tmpdir(), 'ems-server-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function licence(fields: Record<string, unknown>, key: KeyObject = privateKey) {
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      id: 'EMS-2026-0001',
      licensee: 'Ayo Thrift Society',
      plan: 'standard',
      branches: 1,
      issued: '2026-09-01',
      expires: '2099-12-31',
      machine: null,
      ...fields,
    }),
  )
  return `EMS-${payload.toString('base64url')}.${sign(null, payload, key).toString('base64url')}`
}

const sms: SmsMessage[] = []
const start = () =>
  createEmsServer({
    dataDir: dir,
    machineCode: MACHINE,
    licenceKey: publicKey,
    onSms: (m) => sms.push(m),
  })

async function call(
  server: EmsServer,
  method: string,
  path: string,
  body?: unknown,
  token?: string,
) {
  const res = await server.handle(
    new Request(`http://127.0.0.1:47821/api/v1${path}`, {
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

async function signIn(server: EmsServer, email: string, password: string) {
  const login = await call(server, 'POST', '/auth/login/', { email, password })
  expect(login.status).toBe(200)
  const code = /code is (\d{6})/.exec(sms.at(-1)!.message)![1]
  const verified = await call(server, 'POST', '/auth/otp/verify/', {
    challenge_id: login.body.challenge_id,
    code,
  })
  expect(verified.status).toBe(200)
  return verified.body.access as string
}

const onboarding = {
  business: {
    name: 'Ayo Thrift Society',
    address: '3 Ipaja Road, Lagos',
    phone: '0803 111 2222',
    email: '',
  },
  md: {
    first_name: 'Ayo',
    last_name: 'Bankole',
    email: 'ayo@ayothrift.ng',
    phone: '0803 111 3333',
    password: 'Strong2026',
  },
  sample_data: false,
}

describe('desktop server', () => {
  let server = start()

  it('stays locked until licensed and set up', async () => {
    expect((await call(server, 'GET', '/system/status/')).body).toMatchObject({
      licence: null,
      onboarded: false,
      machine_code: MACHINE,
    })
    expect((await call(server, 'GET', '/branches/')).body.code).toBe('licence_required')

    const forged = await call(server, 'POST', '/system/licence/', {
      code: licence({}, generateKeyPairSync('ed25519').privateKey),
    })
    expect(forged.status).toBe(400)
    const elsewhere = await call(server, 'POST', '/system/licence/', {
      code: licence({ machine: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' }),
    })
    expect(elsewhere.body.code).toEqual([expect.stringContaining(MACHINE)])
    const expired = await call(server, 'POST', '/system/licence/', {
      code: licence({ expires: '2020-01-01' }),
    })
    expect(expired.status).toBe(400)

    // Pasted with line breaks, as from an email.
    const code = licence({ machine: MACHINE })
    const ok = await call(server, 'POST', '/system/licence/', {
      code: `${code.slice(0, 40)}\n${code.slice(40)}`,
    })
    expect(ok.status).toBe(200)
    expect((await call(server, 'GET', '/branches/')).body.code).toBe('licence_required')
  })

  it('sets up the business and its managing director', async () => {
    const bad = await call(server, 'POST', '/system/onboarding/', {
      ...onboarding,
      md: { ...onboarding.md, password: 'short' },
    })
    expect(bad.status).toBe(400)
    const done = await call(server, 'POST', '/system/onboarding/', onboarding)
    expect(done.status).toBe(201)
    expect((await call(server, 'POST', '/system/onboarding/', onboarding)).status).toBe(409)

    const token = await signIn(server, 'ayo@ayothrift.ng', 'Strong2026')
    const me = await call(server, 'GET', '/auth/me/', undefined, token)
    expect(me.body).toMatchObject({ role: 'md', first_name: 'Ayo' })
    // Starts empty apart from headquarters.
    const branches = await call(server, 'GET', '/branches/', undefined, token)
    expect((branches.body.results as { kind: string }[]).map((b) => b.kind)).toEqual([
      'headquarters',
    ])
  })

  it('keeps to the licence’s branch limit and survives a restart', async () => {
    const token = await signIn(server, 'ayo@ayothrift.ng', 'Strong2026')
    const branch = {
      name: 'Ipaja',
      code: '01',
      address: '1 Ipaja Road',
      phone: '0803 111 4444',
      areas: ['Ipaja Market'],
      manager_id: null,
      status: 'active',
    }
    expect((await call(server, 'POST', '/branches/', branch, token)).status).toBe(201)
    const second = await call(
      server,
      'POST',
      '/branches/',
      { ...branch, name: 'Ayobo', code: '02' },
      token,
    )
    expect(second.body.code).toBe('licence_limit')

    server.close()
    server = start()
    const again = await signIn(server, 'ayo@ayothrift.ng', 'Strong2026')
    const branches = await call(server, 'GET', '/branches/', undefined, again)
    expect((branches.body.results as { name: string }[]).map((b) => b.name).sort()).toEqual([
      'Headquarters',
      'Ipaja',
    ])
    // Newest-first lists come back in the same order.
    const audit = await call(server, 'GET', '/audit/?ordering=-at', undefined, again)
    expect((audit.body.results as { action: string }[])[0]!.action).toBe('auth.login')
  })

  it('stores passwords hashed and rejects forged tokens', async () => {
    server.close()
    const sql = new DatabaseSync(join(dir, 'ems.sqlite'))
    const row = sql
      .prepare("SELECT json_extract(data, '$.password') AS password FROM staff")
      .get() as { password: string }
    sql.close()
    expect(row.password).toMatch(/^scrypt\$/)
    expect(row.password).not.toContain('Strong2026')

    server = start()
    const forged = `ems.${Buffer.from(JSON.stringify({ sub: 'x', exp: 9e9, typ: 'access' })).toString('base64url')}.sig`
    expect((await call(server, 'GET', '/auth/me/', undefined, forged)).status).toBe(401)
    server.close()
  })
})
