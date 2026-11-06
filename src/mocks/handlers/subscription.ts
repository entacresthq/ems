import { http, HttpResponse } from 'msw'
import { keysToCamel, keysToSnake } from '@/lib/case'
import {
  ORIGIN_HEADER,
  platform,
  SubscriptionError,
  subscriptionErrorBody,
  type SubscriptionGateway,
} from '../platform'
import { api, authenticate, can, forbidden } from '../utils'

/**
 * Hosted EMS: the business's plan and payments, kept by SynchGate. Only people who can
 * change settings see or pay for it. Renewing from the lock screen and coming back from
 * checkout are /system/subscription/ on the EMS server, since nobody is signed in then.
 */

const reply = (body: unknown, status = 200) =>
  HttpResponse.json(keysToSnake(body) as Record<string, unknown>, { status })

async function withGateway(
  request: Request,
  fn: (gateway: SubscriptionGateway, staff: { email: string }) => Promise<Response>,
): Promise<Response> {
  const staff = authenticate(request)
  if (staff instanceof Response) return staff
  if (!can(staff, 'settings.manage')) return forbidden()
  const gateway = platform().subscription
  if (!gateway)
    return reply(
      {
        detail: 'This EMS isn’t a hosted subscription. Its licence comes from Entacrest.',
        code: 'not_hosted',
      },
      404,
    )
  try {
    return await fn(gateway, staff)
  } catch (error) {
    if (error instanceof SubscriptionError) return reply(subscriptionErrorBody(error), error.status)
    throw error
  }
}

export const subscriptionHandlers = [
  http.get(api('/subscription/'), ({ request }) =>
    withGateway(request, async (gateway) => reply(await gateway.summary())),
  ),

  http.post(api('/subscription/checkout/'), ({ request }) =>
    withGateway(request, async (gateway, staff) => {
      const body = keysToCamel(await request.json().catch(() => ({}))) as {
        plan?: unknown
        months?: unknown
      }
      const errors: Record<string, string[]> = {}
      if (typeof body.plan !== 'string' || !body.plan) errors.plan = ['Choose a plan.']
      const months = Number(body.months ?? 1)
      if (!Number.isInteger(months) || months < 1) errors.months = ['Choose how many months.']
      if (Object.keys(errors).length) return reply(errors, 400)
      const origin = request.headers.get(ORIGIN_HEADER) ?? new URL(request.url).origin
      const started = await gateway.checkout({
        plan: body.plan as string,
        months,
        callbackUrl: `${origin}/subscription/return`,
        // The receipt goes to whoever pays.
        email: staff.email,
      })
      return reply(started, 201)
    }),
  ),
]
