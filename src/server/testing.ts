import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { expect } from 'vitest'
import type { EmsServer } from './index'
import type { SmsMessage } from './store'

/** Helpers for the server tests. */

export const MACHINE = 'AAAA-BBBB-CCCC-DDDD'
export const keys = generateKeyPairSync('ed25519')

export function licence(fields: Record<string, unknown> = {}, key: KeyObject = keys.privateKey) {
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

export const onboarding = {
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
}

export async function call(
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

/** Signs in, reading the code from the messages the server "sent". */
export async function signIn(
  server: EmsServer,
  sms: SmsMessage[],
  email: string,
  password: string,
) {
  const before = sms.length
  const login = await call(server, 'POST', '/auth/login/', { email, password })
  expect(login.status).toBe(200)
  await expect.poll(() => sms.length).toBeGreaterThan(before)
  const code = /code is (\d{6})/.exec(sms.at(-1)!.message)![1]
  const verified = await call(server, 'POST', '/auth/otp/verify/', {
    challenge_id: login.body.challenge_id,
    code,
  })
  expect(verified.status).toBe(200)
  return verified.body.access as string
}
