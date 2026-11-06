import { keysToCamel, keysToSnake } from '@/lib/case'
import { SubscriptionError as SaasError, type SubscriptionGateway } from '@/mocks/platform'

export { SaasError }

/**
 * Hosted EMS: SynchGate sells it. Sign-up, plans, payment and each business's licence live
 * in SynchGate's `ems` app; this is the hub's client for it.
 *
 * Settings: EMS_SAAS_URL (SynchGate's address, e.g. https://api.synchgate.com) and
 * EMS_SAAS_KEY (SynchGate's EMS_SERVICE_KEY). SynchGate wraps replies as
 * { status, message, data, errors }; this returns `data`, camelCased.
 */

export interface SaasOptions {
  url: string
  key: string
  /** For tests. */
  fetch?: typeof fetch
}

const UNAVAILABLE = 'Billing can’t be reached right now. Try again in a moment.'

export function saasClient(options: SaasOptions) {
  const base = options.url.replace(/\/+$/, '') + '/v1/ems/'
  const send = options.fetch ?? fetch

  async function call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    forwardedFor?: string | null,
  ): Promise<T> {
    let response: Response
    try {
      response = await send(base + path, {
        method,
        headers: {
          Authorization: `Bearer ${options.key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          // SynchGate limits sign-ups per visitor, not per hub.
          ...(forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(keysToSnake(body)),
        signal: AbortSignal.timeout(30_000),
      })
    } catch (error) {
      console.error('SynchGate unreachable:', error)
      throw new SaasError(503, UNAVAILABLE)
    }
    const reply = (await response.json().catch(() => ({}))) as {
      message?: string
      data?: unknown
      errors?: Record<string, string[]> | null
    }
    if (!response.ok) {
      if (response.status >= 500) throw new SaasError(503, UNAVAILABLE)
      const errors = reply.errors && typeof reply.errors === 'object' ? reply.errors : {}
      throw new SaasError(response.status, reply.message ?? 'The request was refused.', errors)
    }
    return keysToCamel(reply.data ?? {}) as T
  }

  const tenant = (id: string, action = '') =>
    `service/tenants/${encodeURIComponent(id)}/${action ? `${action}/` : ''}`

  return {
    plans: () => call<Record<string, unknown>>('GET', 'plans/'),
    checkSlug: (slug: string) =>
      call<Record<string, unknown>>('GET', `signup/check/?slug=${encodeURIComponent(slug)}`),
    /** The body is passed as the visitor sent it (snake_case). */
    signup: (body: unknown, forwardedFor: string | null) =>
      call<Record<string, unknown>>('POST', 'signup/', body, forwardedFor),

    /** What one business may do with SynchGate, for its EmsServer. */
    forBusiness(id: string): SubscriptionGateway {
      return {
        summary: () => call('GET', tenant(id)),
        checkout: (input) => call('POST', tenant(id, 'checkout'), input),
        renew: (callbackUrl) => call('POST', tenant(id, 'renew'), { callbackUrl }),
        verify: (reference) => call('POST', tenant(id, 'verify'), { reference }),
      }
    },
  }
}

export type SaasClient = ReturnType<typeof saasClient>
