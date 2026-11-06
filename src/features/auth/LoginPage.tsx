import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { authApi } from '@/api/auth'
import { applyServerErrors } from '@/api/forms'
import { isApiError } from '@/api/client'
import { Checkbox, OtpInput, PasswordInput, TextInput } from '@/components/form/inputs'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { config } from '@/config'
import { homePathFor, isFieldUser } from '@/lib/permissions'
import { DEMO_LOGINS, DEMO_OTP, DEMO_PASSWORD } from '@/mocks/demoLogins'
import { useIsDemo, useSystemStatus } from '@/features/setup/useSystemStatus'
import { ROLE_LABELS, type LoginChallenge } from '@/types'
import { AuthLayout, type AuthVariant } from './AuthLayout'
import { useAuth } from './AuthProvider'

const credentialsSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Enter your email address.')
    .email('Enter a valid email address, like name@ems.ng.'),
  password: z.string().min(1, 'Enter your password.'),
})
type Credentials = z.infer<typeof credentialsSchema>

/** Only the email is kept, never the password, and only if the person ticks the box. */
const REMEMBERED_EMAIL_KEY = 'ems.rememberedEmail'

function readRememberedEmail(): string {
  try {
    return window.localStorage.getItem(REMEMBERED_EMAIL_KEY) ?? ''
  } catch {
    return '' // storage blocked (private mode, policy): just start empty
  }
}

function writeRememberedEmail(email: string | null) {
  try {
    if (email) window.localStorage.setItem(REMEMBERED_EMAIL_KEY, email)
    else window.localStorage.removeItem(REMEMBERED_EMAIL_KEY)
  } catch {
    // Not being able to remember is harmless.
  }
}

const otpSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code we sent you.'),
})
type OtpValues = z.infer<typeof otpSchema>

export function LoginPage({ variant = 'office' }: { variant?: AuthVariant }) {
  const [challenge, setChallenge] = useState<LoginChallenge | null>(null)
  const { state } = useAuth()
  const notice = state.status === 'anonymous' ? state.notice : undefined

  return challenge ? (
    <OtpStep
      variant={variant}
      challenge={challenge}
      onChallenge={setChallenge}
      onBack={() => setChallenge(null)}
    />
  ) : (
    <CredentialsStep variant={variant} notice={notice} onChallenge={setChallenge} />
  )
}

function CredentialsStep({
  variant,
  notice,
  onChallenge,
}: {
  variant: AuthVariant
  notice?: string
  onChallenge: (c: LoginChallenge) => void
}) {
  const field = variant === 'field'
  const isDemo = useIsDemo()
  const [formError, setFormError] = useState<string | null>(null)
  const [remembered] = useState(readRememberedEmail)
  const [remember, setRemember] = useState(remembered !== '')
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<Credentials>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { email: remembered, password: '' },
  })

  // With the email already filled in, the next thing to type is the password.
  useEffect(() => {
    if (remembered) setFocus('password')
  }, [remembered, setFocus])

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      const challenge = await authApi.login(values)
      // Only once the password has been accepted, so a typo isn't kept.
      writeRememberedEmail(remember ? values.email : null)
      onChallenge(challenge)
    } catch (error) {
      setFormError(applyServerErrors(error, setError, ['email', 'password']))
    }
  })

  const fillDemo = (email: string) => {
    setValue('email', email, { shouldValidate: true })
    setValue('password', DEMO_PASSWORD, { shouldValidate: true })
  }

  return (
    <AuthLayout
      variant={variant}
      title={field ? 'Sign in to the field app' : 'Sign in'}
      description={
        config.useMocks || config.emsServer
          ? "Use your staff email and password. We'll text a code to your phone."
          : "Use your staff email and password. We'll email you a code."
      }
      aside={isDemo ? <DemoAccounts onPick={fillDemo} field={field} /> : undefined}
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {notice && <Alert tone="warning">{notice}</Alert>}
        {formError && <Alert tone="danger">{formError}</Alert>}
        <TextInput
          label="Email address"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          fieldSize={field ? 'field' : 'md'}
          error={errors.email?.message}
          {...register('email')}
        />
        <PasswordInput
          label="Password"
          autoComplete="current-password"
          fieldSize={field ? 'field' : 'md'}
          error={errors.password?.message}
          {...register('password')}
        />
        <Checkbox
          label="Remember my email address on this computer"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
        />
        <Button
          type="submit"
          variant={field ? 'ink' : 'primary'}
          size={field ? 'xl' : 'lg'}
          loading={isSubmitting}
          loadingLabel="Checking…"
          className="mt-2 w-full"
        >
          Continue
        </Button>
        {config.emsServer ? (
          // No reset emails from the EMS server yet: a manager issues a temporary password.
          <p className="text-ink-2 text-sm">
            Forgot your password? Ask your MD or general manager to reset it.
          </p>
        ) : (
          <Link
            to="/reset-password"
            className="text-ink self-start text-sm font-medium underline underline-offset-2"
          >
            Forgot your password?
          </Link>
        )}
        {!config.useMocks && !config.emsServer && !field && (
          <p className="text-ink-2 border-rule border-t pt-4 text-sm">
            New to EMS?{' '}
            <Link to="/signup" className="text-ink font-medium underline underline-offset-2">
              Start your free trial
            </Link>
          </p>
        )}
      </form>
    </AuthLayout>
  )
}

function OtpStep({
  variant,
  challenge,
  onChallenge,
  onBack,
}: {
  variant: AuthVariant
  challenge: LoginChallenge
  onChallenge: (c: LoginChallenge) => void
  onBack: () => void
}) {
  const field = variant === 'field'
  const status = useSystemStatus()
  const { completeLogin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [formError, setFormError] = useState<string | null>(null)
  const [resendIn, setResendIn] = useState(challenge.resendAfter)
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<OtpValues>({ resolver: zodResolver(otpSchema) })

  useEffect(() => setFocus('code'), [setFocus])

  useEffect(() => {
    const timer = window.setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const onSubmit = handleSubmit(async ({ code }) => {
    setFormError(null)
    try {
      const user = await authApi.verifyOtp({ challengeId: challenge.challengeId, code })
      completeLogin(user)
      const from = (location.state as { from?: string } | null)?.from
      let target = homePathFor(user)
      if (user.mustChangePassword) target = '/change-password'
      else if (from && isFieldUser(user) === from.startsWith('/field')) target = from
      navigate(target, { replace: true })
    } catch (error) {
      if (isApiError(error) && (error.code === 'otp_expired' || error.code === 'otp_locked')) {
        setFormError(error.message)
        return
      }
      setFormError(applyServerErrors(error, setError, ['code']))
    }
  })

  const resend = async () => {
    setResending(true)
    setFormError(null)
    try {
      const next = await authApi.resendOtp(challenge.challengeId)
      onChallenge(next)
      setResendIn(next.resendAfter)
      setResent(true)
    } catch (error) {
      setFormError(isApiError(error) ? error.message : 'Could not send a new code. Try again.')
    } finally {
      setResending(false)
    }
  }

  return (
    <AuthLayout
      variant={variant}
      title="Enter your sign-in code"
      description={
        <>
          We sent a 6-digit code {challenge.otpChannel === 'email' ? 'by email' : 'by SMS'} to{' '}
          <span className="text-ink font-medium whitespace-nowrap">
            {challenge.destinationHint}
          </span>
          . It expires in 5 minutes.
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        {resent && !formError && <Alert tone="success">A new code is on its way.</Alert>}
        <OtpInput
          label="Sign-in code"
          hint={
            config.useMocks || status?.mode === 'demo'
              ? `Demo code: ${DEMO_OTP}`
              : status?.sms === 'outbox'
                ? config.desktop
                  ? 'Until an SMS provider is connected, the code appears in a notification and under File → SMS outbox.'
                  : 'SMS isn’t connected yet. Ask your administrator for the code from the SMS outbox.'
                : undefined
          }
          error={errors.code?.message}
          {...register('code')}
        />
        <Button
          type="submit"
          variant={field ? 'ink' : 'primary'}
          size={field ? 'xl' : 'lg'}
          loading={isSubmitting}
          loadingLabel="Verifying…"
          className="w-full"
        >
          Verify and sign in
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <button
            type="button"
            onClick={onBack}
            className="text-ink font-medium underline underline-offset-2"
          >
            Use a different account
          </button>
          {resendIn > 0 ? (
            <span className="text-ink-3 tabular" aria-live="polite">
              Send a new code in {resendIn}s
            </span>
          ) : (
            <Button size="sm" variant="ghost" onClick={resend} loading={resending}>
              Send a new code
            </Button>
          )}
        </div>
      </form>
    </AuthLayout>
  )
}

function DemoAccounts({ onPick, field }: { onPick: (email: string) => void; field: boolean }) {
  const shown = field ? DEMO_LOGINS.filter((l) => l.role === 'account_officer') : DEMO_LOGINS
  return (
    <section
      aria-labelledby="demo-heading"
      className="border-rule border-t pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6"
    >
      <h2 id="demo-heading" className="text-ink text-sm font-semibold">
        Demo accounts
      </h2>
      <p className="text-ink-2 mt-1 text-sm">
        {config.useMocks ? 'Mock data is on.' : 'This is the demo workspace, with training data.'}{' '}
        Every account uses the password <span className="text-ink font-mono">{DEMO_PASSWORD}</span>{' '}
        and the code <span className="text-ink font-mono">{DEMO_OTP}</span>.
      </p>
      <ul className="divide-rule border-rule mt-3 divide-y border-y">
        {shown.map((l) => (
          <li key={l.email}>
            <button
              type="button"
              onClick={() => onPick(l.email)}
              className="hover:bg-ink-tint flex w-full flex-col items-start px-1 py-2 text-left"
            >
              <span className="text-ink text-sm font-medium">{ROLE_LABELS[l.role]}</span>
              <span className="text-ink-2 text-xs">
                {l.email} · {l.note}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
