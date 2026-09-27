import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'
import { openEmsServer, SqliteBackend, type EmsServer } from './index'
import type { SmsMessage } from './store'
import { call, keys, licence, MACHINE, onboarding, signIn } from './testing'

const dir = mkdtempSync(join(tmpdir(), 'ems-server-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const sms: SmsMessage[] = []
const start = () =>
  openEmsServer({
    storage: new SqliteBackend(join(dir, 'ems.sqlite')),
    machineCode: MACHINE,
    licenceKey: keys.publicKey,
    onSms: (m) => sms.push(m),
  })

describe('EMS server on SQLite', () => {
  let server: EmsServer

  it('stays locked until licensed and set up', async () => {
    server = await start()
    expect((await call(server, 'GET', '/system/status/')).body).toMatchObject({
      mode: 'live',
      licence: null,
      onboarded: false,
      machine_code: MACHINE,
      database: 'sqlite',
      sms: 'outbox',
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

  it('sets up the business and its managing director, with no sample data', async () => {
    const bad = await call(server, 'POST', '/system/onboarding/', {
      ...onboarding,
      md: { ...onboarding.md, password: 'short' },
    })
    expect(bad.status).toBe(400)
    // Asking for sample data is ignored: training data lives in the demo workspace.
    const done = await call(server, 'POST', '/system/onboarding/', {
      ...onboarding,
      sample_data: true,
    })
    expect(done.status).toBe(201)
    expect((await call(server, 'POST', '/system/onboarding/', onboarding)).status).toBe(409)

    const token = await signIn(server, sms, 'ayo@ayothrift.ng', 'Strong2026')
    const me = await call(server, 'GET', '/auth/me/', undefined, token)
    expect(me.body).toMatchObject({ role: 'md', first_name: 'Ayo' })
    const branches = await call(server, 'GET', '/branches/', undefined, token)
    expect((branches.body.results as { kind: string }[]).map((b) => b.kind)).toEqual([
      'headquarters',
    ])
  })

  it('keeps to the licence’s branch limit and survives a restart', async () => {
    const token = await signIn(server, sms, 'ayo@ayothrift.ng', 'Strong2026')
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

    await server.close()
    server = await start()
    const again = await signIn(server, sms, 'ayo@ayothrift.ng', 'Strong2026')
    const branches = await call(server, 'GET', '/branches/', undefined, again)
    expect((branches.body.results as { name: string }[]).map((b) => b.name).sort()).toEqual([
      'Headquarters',
      'Ipaja',
    ])
    // Newest-first lists come back in the same order.
    const audit = await call(server, 'GET', '/audit/?ordering=-at', undefined, again)
    expect((audit.body.results as { action: string }[])[0]!.action).toBe('auth.login')
  })

  it('stores passwords hashed, rejects forged tokens and backs up', async () => {
    const backup = join(dir, 'backup.sqlite')
    await server.backup(backup)
    await server.close()
    for (const file of [join(dir, 'ems.sqlite'), backup]) {
      const sql = new DatabaseSync(file)
      const row = sql
        .prepare("SELECT json_extract(data, '$.password') AS password FROM staff")
        .get() as {
        password: string
      }
      sql.close()
      expect(row.password).toMatch(/^scrypt\$/)
    }

    server = await start()
    const forged = `ems.${Buffer.from(JSON.stringify({ sub: 'x', exp: 9e9, typ: 'access' })).toString('base64url')}.sig`
    expect((await call(server, 'GET', '/auth/me/', undefined, forged)).status).toBe(401)
    await server.close()
  })
})
