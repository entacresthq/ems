import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { SubscriptionError, type SubscriptionGateway } from '@/mocks/platform'
import { openHub, type EmsHub } from './hub'
import { SqliteBackend } from './index'
import type { SaasClient } from './saas'
import type { SmsMessage } from './store'
import { keys, licence, MACHINE, onboarding } from './testing'

const dir = mkdtempSync(join(tmpdir(), 'ems-saas-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const KEY = 'platform-key-for-tests-0123456789'
const sms: Record<string, SmsMessage[]> = {}

/** Stands in for SynchGate. */
const gateway = {
  summary: vi.fn(async () => ({ tenant: { id: 'ayo', status: 'trial' }, plans: [], payments: [] })),
  checkout: vi.fn(async () => ({
    paymentUrl: 'https://checkout.paystack.com/x',
    reference: 'EMS-SUB-1',
  })),
  renew: vi.fn(async () => ({
    paymentUrl: 'https://checkout.paystack.com/r',
    reference: 'EMS-SUB-2',
  })),
  verify: vi.fn(async (): Promise<Awaited<ReturnType<SubscriptionGateway['verify']>>> => ({
    payment: { status: 'paid' },
    tenant: {},
    licence: licence({ id: 'EMS-AYO-002', expires: '2099-12-31' }),
  })),
} satisfies SubscriptionGateway

const saas = {
  plans: vi.fn(async () => ({ plans: [{ code: 'growth' }], trialDays: 14 })),
  checkSlug: vi.fn(async (slug: string) => ({ slug, available: true, reason: null })),
  signup: vi.fn(async () => ({ id: 'ayo', status: 'trial' })),
  forBusiness: vi.fn(() => gateway),
} as unknown as SaasClient

const start = () =>
  openHub({
    registry: new SqliteBackend(join(dir, 'platform.sqlite')),
    businessStorage: (id) => new SqliteBackend(join(dir, `${id}.sqlite`)),
    baseDomain: 'ems.example.ng',
    platformKey: KEY,
    machineCode: MACHINE,
    licenceKey: keys.publicKey,
    onSms: (business, m) => (sms[business] ??= []).push(m),
    saas,
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

async function admin(hub: EmsHub, method: string, path: string, body?: unknown) {
  const res = await hub.admin(
    new Request(`https://ems.example.ng/__platform/businesses${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

async function signIn(
  hub: EmsHub,
  host: string,
  business: string,
  email: string,
  password: string,
) {
  const before = sms[business]?.length ?? 0
  const login = await call(hub, host, 'POST', '/auth/login/', { email, password })
  expect(login.status).toBe(200)
  await expect.poll(() => sms[business]?.length ?? 0).toBeGreaterThan(before)
  const code = /code is (\d{6})/.exec(sms[business]!.at(-1)!.message)![1]
  const verified = await call(hub, host, 'POST', '/auth/otp/verify/', {
    challenge_id: login.body.challenge_id,
    code,
  })
  expect(verified.status).toBe(200)
  return verified.body.access as string
}

describe('hosted EMS (SynchGate)', () => {
  it('passes sign-up at the bare address to SynchGate', async () => {
    const hub = await start()
    const status = await call(hub, 'ems.example.ng', 'GET', '/system/status/')
    expect(status.status).toBe(404)
    expect(status.body.code).toBe('signup')

    expect((await call(hub, 'ems.example.ng', 'GET', '/signup/plans/')).body.trial_days).toBe(14)
    const check = await call(hub, 'www.ems.example.ng', 'GET', '/signup/check/?slug=ayo')
    expect(check.body.available).toBe(true)
    expect(saas.checkSlug).toHaveBeenCalledWith('ayo')

    const signed = await call(hub, 'ems.example.ng', 'POST', '/signup/', { slug: 'ayo' })
    expect(signed.status).toBe(201)
    expect(signed.body.address).toBe('https://ayo.ems.example.ng/')

    vi.mocked(saas.signup).mockRejectedValueOnce(
      new SubscriptionError(400, 'Fix it', { slug: ['Taken.'] }),
    )
    const refused = await call(hub, 'ems.example.ng', 'POST', '/signup/', { slug: 'ayo' })
    expect(refused.status).toBe(400)
    expect(refused.body).toEqual({ slug: ['Taken.'] })

    // Other unknown addresses still have no EMS, and no sign-up.
    expect((await call(hub, 'nobody.ems.example.ng', 'GET', '/signup/plans/')).body.code).toBe(
      'unknown_business',
    )
    await hub.close()
  })

  it('creates a business already set up, so its MD signs in at once', async () => {
    const hub = await start()
    const created = await admin(hub, 'POST', '', {
      id: 'ayo',
      name: 'Ayo Thrift Society',
      licence: licence({ expires: '2099-12-31' }),
      setup: onboarding,
    })
    expect(created.status).toBe(201)
    expect(created.body.onboarded).toBe(true)

    const status = await call(hub, 'ayo.ems.example.ng', 'GET', '/system/status/')
    expect(status.body.subscription).toBe(true)
    expect(status.body.onboarded).toBe(true)
    const token = await signIn(hub, 'ayo.ems.example.ng', 'ayo', onboarding.md.email, 'Strong2026')
    expect(token).toBeTruthy()
    await hub.close()
  })

  it('refuses a set-up business with bad details or no working licence, and keeps nothing', async () => {
    const hub = await start()
    const weak = await admin(hub, 'POST', '', {
      id: 'weak',
      name: 'Weak',
      licence: licence(),
      setup: { ...onboarding, md: { ...onboarding.md, password: 'short' } },
    })
    expect(weak.status).toBe(400)
    expect(Object.keys(weak.body)).toContain('setup.md.password')

    const ended = await admin(hub, 'POST', '', {
      id: 'ended',
      name: 'Ended',
      licence: licence({ expires: '2020-01-01' }),
      setup: onboarding,
    })
    expect(ended.status).toBe(400)
    expect(ended.body.licence).toBeTruthy()
    expect(hub.businesses().map((b) => b.id)).not.toContain('weak')
    expect(hub.businesses().map((b) => b.id)).not.toContain('ended')
    await hub.close()
  })

  it('lets the MD see and pay for the subscription, with links back to their own address', async () => {
    const hub = await start()
    const host = 'ayo.ems.example.ng'
    expect((await call(hub, host, 'GET', '/subscription/')).status).toBe(401)

    const token = await signIn(hub, host, 'ayo', onboarding.md.email, 'Strong2026')
    const summary = await call(hub, host, 'GET', '/subscription/', undefined, token)
    expect(summary.status).toBe(200)
    expect(summary.body.tenant).toEqual({ id: 'ayo', status: 'trial' })

    const started = await call(
      hub,
      host,
      'POST',
      '/subscription/checkout/',
      { plan: 'growth', months: 3 },
      token,
    )
    expect(started.status).toBe(201)
    expect(started.body.payment_url).toBe('https://checkout.paystack.com/x')
    expect(gateway.checkout).toHaveBeenLastCalledWith({
      plan: 'growth',
      months: 3,
      callbackUrl: 'https://ayo.ems.example.ng/subscription/return',
      email: onboarding.md.email,
    })
    await hub.close()
  })

  it('renews from the lock screen and unlocks when the payment is confirmed', async () => {
    const hub = await start()
    const host = 'ayo.ems.example.ng'
    // No working licence: EMS is locked, but the business is still on the hub.
    expect((await admin(hub, 'POST', '', { id: 'late', name: 'Late Payers' })).status).toBe(201)
    const locked = await call(hub, 'late.ems.example.ng', 'GET', '/system/status/')
    expect(locked.body.licence).toBeNull()

    const renew = await call(hub, 'late.ems.example.ng', 'POST', '/system/subscription/renew/', {})
    expect(renew.status).toBe(201)
    expect(gateway.renew).toHaveBeenLastCalledWith(
      'https://late.ems.example.ng/subscription/return',
    )

    const verified = await call(
      hub,
      'late.ems.example.ng',
      'POST',
      '/system/subscription/verify/',
      {
        reference: 'EMS-SUB-2',
      },
    )
    expect(verified.status).toBe(200)
    expect(
      (verified.body.status as { licence: { id: string; status: string } }).licence,
    ).toMatchObject({
      id: 'EMS-AYO-002',
      status: 'valid',
    })
    expect((await call(hub, host, 'POST', '/system/subscription/verify/', {})).status).toBe(400)
    await hub.close()
  })
})
