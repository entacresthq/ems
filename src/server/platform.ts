import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Platform, SubscriptionGateway } from '@/mocks/platform'

const SCRYPT = { N: 16384, r: 8, p: 1 } as const
const KEY_LENGTH = 32

/** Passwords are stored as "scrypt$<salt>$<hash>", never as typed. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, KEY_LENGTH, SCRYPT)
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

export function verifyPassword(stored: string, password: string): boolean {
  const [scheme, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64url')
  const actual = scryptSync(password, Buffer.from(salt, 'base64url'), expected.length, SCRYPT)
  return timingSafeEqual(actual, expected)
}

export function livePlatform({
  secret,
  sendSms,
  branchLimit,
  fixedOtp,
  sessionCookie = 'ems_refresh',
  business = null,
  subscription = null,
}: {
  /** Signs session tokens. Kept in the database, made at first start. */
  secret: string
  sendSms: (to: string, message: string) => void
  branchLimit: () => number | null
  /** The demo workspace always uses the same sign-in code. */
  fixedOtp?: string
  sessionCookie?: string
  /** Which business, when one server holds several. */
  business?: string | null
  /** Hosted EMS: the business's subscription with SynchGate. */
  subscription?: SubscriptionGateway | null
}): Platform {
  return {
    live: true,
    hashPassword,
    verifyPassword,
    sign: (data) => createHmac('sha256', secret).update(data).digest('base64url'),
    otp: () => fixedOtp ?? String(randomInt(0, 1_000_000)).padStart(6, '0'),
    sendSms,
    branchLimit,
    sessionCookie,
    business,
    subscription,
  }
}
