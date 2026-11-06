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
  /**
   * Name of the session cookie. Cookies ignore the port, so two EMS servers on one
   * computer (the desktop's live and demo workspaces) need different names.
   */
  sessionCookie: string
  /** Which business this is, when one server holds several; null otherwise. */
  business?: string | null
  /** Hosted EMS: the business's subscription with SynchGate (src/server/saas.ts). */
  subscription?: SubscriptionGateway | null
}

/**
 * The address a request really came in on. The EMS server sets it, overwriting any a client
 * sent, because the handlers see every request at http://localhost/api/v1/.
 */
export const ORIGIN_HEADER = 'X-EMS-Origin'

export interface CheckoutStarted {
  paymentUrl: string
  reference: string
}

/** One hosted business's plan and payments, kept by SynchGate. Replies are camelCased. */
export interface SubscriptionGateway {
  summary(): Promise<unknown>
  checkout(input: {
    plan: string
    months: number
    callbackUrl: string
    email?: string
  }): Promise<CheckoutStarted>
  /** A month of the current plan, from the lock screen. */
  renew(callbackUrl: string): Promise<CheckoutStarted>
  /** After checkout: `licence` is the new licence code once the payment is confirmed. */
  verify(reference: string): Promise<{ payment: unknown; tenant: unknown; licence: string | null }>
}

/** SynchGate refused or couldn't be reached (status 503). */
export class SubscriptionError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Field errors in DRF's shape, e.g. { slug: ['…'] }. */
    readonly errors: Record<string, string[]> = {},
  ) {
    super(message)
    this.name = 'SubscriptionError'
  }
}

/** A SynchGate refusal as an EMS API reply body: field errors as given, otherwise `detail`. */
export function subscriptionErrorBody(error: SubscriptionError) {
  return Object.keys(error.errors).length
    ? error.errors
    : {
        detail: error.message,
        code: error.status === 503 ? 'billing_unavailable' : 'billing_refused',
      }
}

const demo: Platform = {
  live: false,
  hashPassword: (password) => password,
  verifyPassword: (stored, password) => stored === password,
  sign: () => 'sig',
  otp: () => DEMO_OTP,
  sendSms: () => undefined,
  branchLimit: () => null,
  sessionCookie: 'ems_refresh',
}

let current: Platform = demo
let scopeOf: (() => Platform | undefined) | null = null

export function platform(): Platform {
  if (scopeOf) {
    const scoped = scopeOf()
    if (!scoped) throw new Error('No business is in scope for this request.')
    return scoped
  }
  return current
}

/** One server, several businesses: each request uses its business's platform (src/server/hub.ts). */
export function setPlatformScope(resolve: () => Platform | undefined) {
  scopeOf = resolve
}

export function setPlatform(next: Platform) {
  current = next
}
