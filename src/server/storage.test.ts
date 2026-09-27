import { PGlite } from '@electric-sql/pglite'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { http, passthrough } from 'msw'
import { afterAll, describe, expect, it } from 'vitest'
import { server as mockApi } from '@/mocks/node'
import { createRequestListener } from './http'
import { copyDatabase, openEmsServer, SqliteBackend } from './index'
import { PostgresBackend, type SqlClient } from './storage/postgres'
import type { Backend, Changes } from './storage/types'
import type { SmsMessage } from './store'
import { call, keys, licence, MACHINE, onboarding, signIn } from './testing'

const dir = mkdtempSync(join(tmpdir(), 'ems-storage-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** A real PostgreSQL (PGlite), standing in for Supabase. */
const pg = new PGlite()
const pgBackend = () =>
  new PostgresBackend('pglite, schema ems', 'ems', async () => pg as unknown as SqlClient)

/** Counts what a backend writes. */
function counting(backend: Backend) {
  const writes: Changes[] = []
  const wrapped: Backend = Object.create(backend) as Backend
  wrapped.apply = async (changes) => {
    writes.push(changes)
    return backend.apply.call(wrapped, changes)
  }
  return { backend: wrapped, writes }
}

const sms: SmsMessage[] = []
const common = {
  machineCode: MACHINE,
  licenceKey: keys.publicKey,
  onSms: (m: SmsMessage) => sms.push(m),
}

describe('storage and deployment', () => {
  it('runs on PostgreSQL (Supabase) and reloads without rewriting anything', async () => {
    let server = await openEmsServer({ storage: pgBackend(), ...common })
    expect(server.status().database).toBe('postgres')
    await call(server, 'POST', '/system/licence/', { code: licence({ branches: 3 }) })
    expect((await call(server, 'POST', '/system/onboarding/', onboarding)).status).toBe(201)
    const token = await signIn(server, sms, 'ayo@ayothrift.ng', 'Strong2026')
    const branch = {
      name: 'Ikotun',
      code: '01',
      address: '5 Ikotun Road',
      phone: '0803 222 1111',
      areas: ['Ikotun Market'],
      manager_id: null,
      status: 'active',
    }
    expect((await call(server, 'POST', '/branches/', branch, token)).status).toBe(201)
    await server.close()

    const { rows } = await pg.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM ems.branches WHERE data->>'name' = 'Ikotun'",
    )
    expect(rows[0]!.n).toBe(1)
    // The tables sit outside Supabase's public API schema, with row-level security on.
    const rls = await pg.query<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE oid = 'ems.staff'::regclass",
    )
    expect(rls.rows[0]!.relrowsecurity).toBe(true)

    // Reopen: jsonb reorders keys, but reading back must not look like a change.
    const counted = counting(pgBackend())
    server = await openEmsServer({ storage: counted.backend, ...common })
    const again = await signIn(server, sms, 'ayo@ayothrift.ng', 'Strong2026')
    const branches = await call(server, 'GET', '/branches/', undefined, again)
    expect((branches.body.results as { name: string }[]).map((b) => b.name)).toContain('Ikotun')
    const staffWrites = counted.writes.flatMap((c) => c.upserts.staff ?? [])
    const branchWrites = counted.writes.flatMap((c) => c.upserts.branches ?? [])
    expect(branchWrites).toHaveLength(0)
    // Only the sign-in time changed.
    expect(staffWrites).toHaveLength(1)
    await server.close()
  })

  it('copies a desktop database into an empty PostgreSQL database', async () => {
    const file = join(dir, 'copy-source.sqlite')
    let server = await openEmsServer({ storage: new SqliteBackend(file), ...common })
    await call(server, 'POST', '/system/licence/', { code: licence() })
    await call(server, 'POST', '/system/onboarding/', onboarding)
    await server.close()

    const target = new PGlite()
    const targetBackend = () =>
      new PostgresBackend('copy target', 'ems', async () => target as unknown as SqlClient)
    const { records } = await copyDatabase(new SqliteBackend(file), targetBackend())
    expect(records).toBeGreaterThan(0)
    await expect(copyDatabase(new SqliteBackend(file), targetBackend())).rejects.toThrow(
      /already has EMS data/,
    )

    server = await openEmsServer({ storage: targetBackend(), ...common })
    // Same licence, same people, same password.
    expect(server.status()).toMatchObject({ onboarded: true, licence: { status: 'valid' } })
    await signIn(server, sms, 'ayo@ayothrift.ng', 'Strong2026')
    await server.close()
  })

  it('runs a demo workspace beside the live one, sharing the licence', async () => {
    const licenceFile = join(dir, 'licence.key')
    const live = await openEmsServer({
      storage: new SqliteBackend(join(dir, 'live.sqlite')),
      licenceFile,
      ...common,
    })
    await call(live, 'POST', '/system/licence/', { code: licence() })
    await call(live, 'POST', '/system/onboarding/', onboarding)
    await live.close()

    const demo = await openEmsServer({
      storage: new SqliteBackend(join(dir, 'demo.sqlite')),
      mode: 'demo',
      licenceFile,
      ...common,
    })
    expect(demo.status()).toMatchObject({
      mode: 'demo',
      onboarded: true,
      licence: { status: 'valid' },
    })
    // Sample accounts, the demo password and the fixed demo code.
    const login = await call(demo, 'POST', '/auth/login/', {
      email: 'gm@ems.ng',
      password: 'Demo@2026',
    })
    const verified = await call(demo, 'POST', '/auth/otp/verify/', {
      challenge_id: login.body.challenge_id,
      code: '123456',
    })
    expect(verified.status).toBe(200)
    // Cookies ignore the port, so the demo's session cookie must not share the live one's name.
    const again = await call(demo, 'POST', '/auth/login/', {
      email: 'gm@ems.ng',
      password: 'Demo@2026',
    })
    const raw = await demo.handle(
      new Request('http://127.0.0.1:47822/api/v1/auth/otp/verify/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge_id: again.body.challenge_id, code: '123456' }),
      }),
    )
    expect(raw.headers.get('set-cookie')).toMatch(/^ems_demo_refresh=/)
    await demo.close()

    // The live data is untouched by the demo.
    const reopened = await openEmsServer({
      storage: new SqliteBackend(join(dir, 'live.sqlite')),
      licenceFile,
      ...common,
    })
    await signIn(reopened, sms, 'ayo@ayothrift.ng', 'Strong2026')
    await reopened.close()
  })

  it('serves the web app, the API and a key-protected SMS outbox over HTTP', async () => {
    const webRoot = join(dir, 'web')
    mkdirSync(join(webRoot, 'assets'), { recursive: true })
    writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>EMS</title>')
    writeFileSync(join(webRoot, 'assets', 'app-1234.js'), 'console.log(1)')
    const ems = await openEmsServer({
      storage: new SqliteBackend(join(dir, 'http.sqlite')),
      ...common,
    })
    const server = createServer(
      createRequestListener({
        ems,
        webRoot,
        outbox: { access: 'key', key: 'secret-key' },
        trustProxy: true,
      }),
    )
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    // The test set-up mocks every request; let these reach the real server.
    mockApi.use(http.all(/^http:\/\/127\.0\.0\.1:\d+\//, () => passthrough()))
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    try {
      const route = await fetch(`${base}/customers/123`)
      expect(await route.text()).toContain('<title>EMS</title>')
      expect(route.headers.get('x-frame-options')).toBe('DENY')
      const asset = await fetch(`${base}/assets/app-1234.js`)
      expect(asset.headers.get('cache-control')).toContain('immutable')
      expect((await fetch(`${base}/../package.json`)).status).not.toBe(200)

      expect((await fetch(`${base}/api/v1/system/status/`)).status).toBe(200)
      expect((await fetch(`${base}/__sms.json`)).status).toBe(404)
      expect((await fetch(`${base}/__sms.json?key=wrong`)).status).toBe(404)
      expect((await fetch(`${base}/__sms.json?key=secret-key`)).status).toBe(200)
      // Behind an HTTPS proxy, HSTS is on.
      const https = await fetch(`${base}/api/v1/system/status/`, {
        headers: { 'X-Forwarded-Proto': 'https' },
      })
      expect(https.headers.get('strict-transport-security')).toBeTruthy()
    } finally {
      server.close()
      await ems.close()
    }
  })
})

describe('database connection messages', () => {
  it('explains the usual Supabase set-up mistakes', async () => {
    const { explainConnectionError } = await import('./storage/postgres')
    const err = (message: string, code?: string) => Object.assign(new Error(message), { code })
    expect(
      explainConnectionError(err('password authentication failed for user "postgres"'), 'x'),
    ).toMatch(/password is wrong/)
    expect(
      explainConnectionError(err('getaddrinfo ENOTFOUND', 'ENOTFOUND'), 'db.abc.supabase.co'),
    ).toMatch(/Session pooler/)
    expect(
      explainConnectionError(err('getaddrinfo ENOTFOUND', 'ENOTFOUND'), 'typo.example.com'),
    ).toMatch(/Can’t find/)
    expect(
      explainConnectionError(err('Connection terminated due to connection timeout'), 'h'),
    ).toMatch(/15 seconds/)
  })
})
