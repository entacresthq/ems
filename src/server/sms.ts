/**
 * Sending text messages. Every message is kept in the SMS outbox; with a provider
 * configured it is also sent to the phone.
 *
 *   EMS_SMS_PROVIDER=termii          TERMII_API_KEY, TERMII_SENDER_ID (default "EMS")
 *   EMS_SMS_PROVIDER=africastalking  AT_USERNAME, AT_API_KEY, AT_SENDER_ID (optional)
 *   EMS_SMS_PROVIDER=outbox          nothing is sent (default; for testing)
 */

export type SmsProviderName = 'outbox' | 'termii' | 'africastalking'

export interface SmsProvider {
  name: SmsProviderName
  send(to: string, message: string): Promise<void>
}

/** 0803 555 1234 → 2348035551234 */
export function internationalNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('234')) return digits
  if (digits.startsWith('0')) return `234${digits.slice(1)}`
  return digits
}

async function check(response: Response, provider: string) {
  if (!response.ok)
    throw new Error(
      `${provider} refused the message (${response.status}): ${await response.text()}`,
    )
}

export function smsProvider(env: Record<string, string | undefined>): SmsProvider {
  const name = (env.EMS_SMS_PROVIDER ?? 'outbox').toLowerCase()
  if (name === 'termii') {
    const key = env.TERMII_API_KEY
    if (!key) throw new Error('EMS_SMS_PROVIDER is termii but TERMII_API_KEY is not set.')
    return {
      name: 'termii',
      async send(to, message) {
        const response = await fetch('https://api.ng.termii.com/api/sms/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: key,
            to: internationalNumber(to),
            from: env.TERMII_SENDER_ID ?? 'EMS',
            sms: message,
            type: 'plain',
            // The DND route reaches numbers on Do-Not-Disturb, which sign-in codes need.
            channel: env.TERMII_CHANNEL ?? 'dnd',
          }),
        })
        await check(response, 'Termii')
      },
    }
  }
  if (name === 'africastalking') {
    const username = env.AT_USERNAME
    const apiKey = env.AT_API_KEY
    if (!username || !apiKey)
      throw new Error(
        'EMS_SMS_PROVIDER is africastalking but AT_USERNAME or AT_API_KEY is not set.',
      )
    const host =
      username === 'sandbox' ? 'api.sandbox.africastalking.com' : 'api.africastalking.com'
    return {
      name: 'africastalking',
      async send(to, message) {
        const form = new URLSearchParams({ username, to: `+${internationalNumber(to)}`, message })
        if (env.AT_SENDER_ID) form.set('from', env.AT_SENDER_ID)
        const response = await fetch(`https://${host}/version1/messaging`, {
          method: 'POST',
          headers: {
            apiKey,
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: form,
        })
        await check(response, "Africa's Talking")
      },
    }
  }
  if (name !== 'outbox')
    throw new Error(`Unknown EMS_SMS_PROVIDER "${name}". Use outbox, termii or africastalking.`)
  return { name: 'outbox', send: async () => undefined }
}
