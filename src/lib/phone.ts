import { z } from 'zod'

/** Nigerian mobile numbers: 070x, 080x, 081x, 090x, 091x. */
const LOCAL_MOBILE = /^0[789][01]\d{8}$/

/** Normalise "0803 123 4567", "+2348031234567" or "2348031234567" to "08031234567". */
export function normalisePhone(input: string): string | null {
  let local = input.replace(/[\s\-().]/g, '')
  if (local.startsWith('+234')) local = '0' + local.slice(4)
  else if (local.startsWith('234') && local.length === 13) local = '0' + local.slice(3)
  return LOCAL_MOBILE.test(local) ? local : null
}

export function toE164(input: string): string | null {
  const local = normalisePhone(input)
  return local ? `+234${local.slice(1)}` : null
}

/** 0803 123 4567 */
export function formatPhone(input: string): string {
  const local = normalisePhone(input)
  if (!local) return input
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`
}

/** 0803 ••• 4567 — for OTP hints. */
export function maskPhone(input: string): string {
  const local = normalisePhone(input) ?? input
  return `${local.slice(0, 4)} ••• ${local.slice(-4)}`
}

export const phoneSchema = z
  .string()
  .trim()
  .min(1, 'Enter a phone number.')
  .refine((v) => normalisePhone(v) !== null, {
    message: 'Enter a Nigerian mobile number, like 0803 123 4567 or +234 803 123 4567.',
  })
  .transform((v) => normalisePhone(v) ?? v)
