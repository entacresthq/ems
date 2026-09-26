import { delay, http, HttpResponse } from 'msw'
import { maskPhone } from '@/lib/phone'
import { db, updateStaff } from '../db'
import { audit } from '../domain'
import { DEMO_OTP, type StaffRecord } from '../seed/generate'
import {
  api,
  authenticate,
  issueAccess,
  issueRefresh,
  readRefresh,
  REFRESH_COOKIE,
  REFRESH_TTL_S,
  serialize,
  toAuthUser,
  validationError,
} from '../utils'

interface Challenge {
  staffId: string
  attemptsLeft: number
  expiresAt: number
  resendAvailableAt: number
}

const challenges = new Map<string, Challenge>()
const OTP_TTL_MS = 5 * 60 * 1000
const RESEND_AFTER_S = 30
const MAX_OTP_ATTEMPTS = 5

// Browsers cannot see HttpOnly cookies set by a mock, so the flag is left off
// here. The real backend must set HttpOnly; Secure; SameSite=Strict.
const refreshCookie = (value: string, maxAge: number) =>
  `${REFRESH_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Strict`

function newChallenge(staff: StaffRecord) {
  const id = crypto.randomUUID()
  challenges.set(id, {
    staffId: staff.id,
    attemptsLeft: MAX_OTP_ATTEMPTS,
    expiresAt: Date.now() + OTP_TTL_MS,
    resendAvailableAt: Date.now() + RESEND_AFTER_S * 1000,
  })
  return {
    challenge_id: id,
    otp_channel: 'sms',
    destination_hint: maskPhone(staff.phone),
    resend_after: RESEND_AFTER_S,
  }
}

const PASSWORD_RULES: [RegExp, string][] = [
  [/.{8,}/, 'Use at least 8 characters.'],
  [/[A-Z]/, 'Include at least one capital letter.'],
  [/[a-z]/, 'Include at least one lowercase letter.'],
  [/\d/, 'Include at least one number.'],
]

function passwordProblems(password: string): string[] {
  return PASSWORD_RULES.filter(([rule]) => !rule.test(password)).map(([, msg]) => msg)
}

type Body = Record<string, unknown>
const str = (body: Body, key: string) =>
  typeof body[key] === 'string' ? (body[key] as string) : ''

export const authHandlers = [
  http.post(api('/auth/login/'), async ({ request }) => {
    await delay()
    const body = (await request.json()) as Body
    const email = str(body, 'email').trim().toLowerCase()
    const password = str(body, 'password')
    const missing: Record<string, string[]> = {}
    if (!email) missing.email = ['Enter your email address.']
    if (!password) missing.password = ['Enter your password.']
    if (Object.keys(missing).length) return validationError(missing)

    const staff = db().staff.find((s) => s.email === email)
    if (!staff || staff.password !== password) {
      return validationError({
        nonFieldErrors: ['The email or password is incorrect. Check both and try again.'],
      })
    }
    if (staff.status !== 'active') {
      return HttpResponse.json(
        {
          detail: `Your account is ${staff.status}. Contact your branch manager to restore access.`,
          code: 'account_inactive',
        },
        { status: 403 },
      )
    }
    return HttpResponse.json(newChallenge(staff))
  }),

  http.post(api('/auth/otp/resend/'), async ({ request }) => {
    await delay()
    const body = (await request.json()) as Body
    const challengeId = str(body, 'challenge_id')
    const challenge = challenges.get(challengeId)
    if (!challenge) {
      return HttpResponse.json(
        { detail: 'This sign-in attempt has expired. Start again.', code: 'challenge_expired' },
        { status: 400 },
      )
    }
    const wait = Math.ceil((challenge.resendAvailableAt - Date.now()) / 1000)
    if (wait > 0) {
      return HttpResponse.json(
        { detail: `Wait ${wait} seconds before requesting another code.`, code: 'throttled' },
        { status: 429 },
      )
    }
    challenges.delete(challengeId)
    const staff = db().staff.find((s) => s.id === challenge.staffId)!
    return HttpResponse.json(newChallenge(staff))
  }),

  http.post(api('/auth/otp/verify/'), async ({ request }) => {
    await delay()
    const body = (await request.json()) as Body
    const challengeId = str(body, 'challenge_id')
    const code = str(body, 'code').trim()
    const challenge = challenges.get(challengeId)
    if (!challenge || challenge.expiresAt < Date.now()) {
      challenges.delete(challengeId)
      return HttpResponse.json(
        { detail: 'This code has expired. Request a new code.', code: 'otp_expired' },
        { status: 400 },
      )
    }
    if (!/^\d{6}$/.test(code)) return validationError({ code: ['Enter the 6-digit code.'] })
    if (code !== DEMO_OTP) {
      challenge.attemptsLeft -= 1
      if (challenge.attemptsLeft <= 0) {
        challenges.delete(challengeId)
        return HttpResponse.json(
          {
            detail: 'Too many incorrect codes. Sign in again to get a new code.',
            code: 'otp_locked',
          },
          { status: 400 },
        )
      }
      return validationError({
        code: [
          `That code is incorrect. You have ${challenge.attemptsLeft} ${challenge.attemptsLeft === 1 ? 'attempt' : 'attempts'} left.`,
        ],
      })
    }
    challenges.delete(challengeId)
    const staff = db().staff.find((s) => s.id === challenge.staffId)!
    const user = toAuthUser(staff)
    updateStaff(staff, { lastLoginAt: new Date().toISOString() })
    audit(staff, 'auth.login', 'session', null, 'Signed in with password and SMS code')
    return HttpResponse.json(
      { access: issueAccess(staff.id), user: serialize(user) },
      { headers: { 'Set-Cookie': refreshCookie(issueRefresh(staff.id), REFRESH_TTL_S) } },
    )
  }),

  http.post(api('/auth/token/refresh/'), async ({ cookies }) => {
    await delay(150)
    const staff = readRefresh(cookies[REFRESH_COOKIE])
    if (!staff) {
      return HttpResponse.json(
        { detail: 'Token is invalid or expired', code: 'token_not_valid' },
        { status: 401 },
      )
    }
    return HttpResponse.json({ access: issueAccess(staff.id) })
  }),

  http.post(api('/auth/logout/'), async () => {
    await delay(150)
    return new HttpResponse(null, {
      status: 204,
      headers: { 'Set-Cookie': refreshCookie('', 0) },
    })
  }),

  http.get(api('/auth/me/'), async ({ request }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    return HttpResponse.json(serialize(toAuthUser(staff)))
  }),

  http.post(api('/auth/password/change/'), async ({ request }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    const body = (await request.json()) as Body
    const current = str(body, 'current_password')
    const next = str(body, 'new_password')
    if (current !== staff.password) {
      return validationError({ currentPassword: ['Your current password is incorrect.'] })
    }
    const problems = passwordProblems(next)
    if (problems.length) return validationError({ newPassword: problems })
    if (next === current) {
      return validationError({
        newPassword: ['Choose a password different from your current one.'],
      })
    }
    updateStaff(staff, { password: next, mustChangePassword: false })
    audit(staff, 'auth.password_change', 'staff', staff.id, 'Changed own password')
    return HttpResponse.json(serialize(toAuthUser(staff)))
  }),

  http.post(api('/auth/password/reset/'), async ({ request }) => {
    await delay()
    const body = (await request.json()) as Body
    if (!str(body, 'email').trim()) return validationError({ email: ['Enter your email address.'] })
    // Always succeed so the response never reveals which emails exist.
    return new HttpResponse(null, { status: 204 })
  }),

  http.post(api('/auth/password/reset/confirm/'), async ({ request }) => {
    await delay()
    const body = (await request.json()) as Body
    const email = decodeUid(str(body, 'uid'))
    const staff = db().staff.find((s) => s.email === email)
    if (!staff || str(body, 'token') !== 'demo') {
      return HttpResponse.json(
        {
          detail: 'This reset link is invalid or has expired. Request a new one.',
          code: 'invalid_token',
        },
        { status: 400 },
      )
    }
    const next = str(body, 'new_password')
    const problems = passwordProblems(next)
    if (problems.length) return validationError({ newPassword: problems })
    updateStaff(staff, { password: next, mustChangePassword: false })
    return new HttpResponse(null, { status: 204 })
  }),
]

function decodeUid(uid: string): string {
  try {
    return atob(uid.replace(/-/g, '+').replace(/_/g, '/'))
  } catch {
    return ''
  }
}
