import { DEMO_OTP } from './demoLogins'

/**
 * What differs between the in-browser demo and the desktop app's live server.
 * The demo keeps passwords readable, signs nothing and always uses code 123456.
 * The desktop server swaps in hashed passwords, signed tokens, random sign-in
 * codes and an SMS outbox (see src/server/platform.ts).
 */
export interface Platform {
  /** True on the desktop app's live server; false in the browser demo and tests. */
  live: boolean
  hashPassword(password: string): string
  verifyPassword(stored: string, password: string): boolean
  /** Signature for a token body. */
  sign(data: string): string
  /** A new 6-digit sign-in code. */
  otp(): string
  /** Send a text message. The demo sends nothing. */
  sendSms(to: string, message: string): void
  /** Most operational branches the licence allows; null for no limit. */
  branchLimit(): number | null
}

const demo: Platform = {
  live: false,
  hashPassword: (password) => password,
  verifyPassword: (stored, password) => stored === password,
  sign: () => 'sig',
  otp: () => DEMO_OTP,
  sendSms: () => undefined,
  branchLimit: () => null,
}

let current: Platform = demo

export function platform(): Platform {
  return current
}

export function setPlatform(next: Platform) {
  current = next
}
