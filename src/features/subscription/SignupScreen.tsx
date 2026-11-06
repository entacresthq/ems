import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { isApiError } from '@/api/client'
import { signupApi, type SignupRequest } from '@/api/subscription'
import { PasswordInput, TextInput } from '@/components/form/inputs'
import { ErrorState, LoadingState } from '@/components/states'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Logo } from '@/components/ui/Logo'
import { PasswordChecklist, PASSWORD_RULES } from '@/features/auth/passwordRules'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { formatDate } from '@/lib/dates'
import { PlanPicker } from './PlanPicker'

type Errors = Partial<Record<keyof SignupRequest | 'confirm' | 'form', string>>

/** A new business picks a plan and starts its free trial (public, at /signup). */
export function SignupScreen() {
  useDocumentTitle('Start your free trial')
  const offer = useQuery({ queryKey: ['signup', 'offer'], queryFn: signupApi.offer })
  const [done, setDone] = useState<{
    trialEndsAt: string | null
    email: string
  } | null>(null)

  return (
    <div className="bg-paper min-h-dvh">
      <div className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="mb-8">
          <Logo withProduct />
        </div>
        {offer.isPending ? (
          <LoadingState />
        ) : offer.isError ? (
          <ErrorState error={offer.error} onRetry={() => void offer.refetch()} />
        ) : done ? (
          <Ready {...done} />
        ) : (
          <SignupForm plans={offer.data.plans} trialDays={offer.data.trialDays} onDone={setDone} />
        )}
      </div>
    </div>
  )
}

function Ready({ trialEndsAt, email }: { trialEndsAt: string | null; email: string }) {
  return (
    <main className="border-rule bg-surface max-w-2xl rounded border p-6 sm:p-8">
      <h1 className="text-ink text-xl font-semibold">Your EMS is ready</h1>
      <div className="mt-4 flex flex-col gap-4 text-sm">
        <p>
          Sign in as <strong>{email}</strong> with the password you chose. A 6-digit code is sent to
          your mobile number each time.
          {trialEndsAt && <> Your free trial runs until {formatDate(trialEndsAt)}.</>}
        </p>
        <p className="text-ink-2">
          Next, add your branches, then your staff, thrift plans and loan products. You’ll find them
          under Administration and Lending.
        </p>
        <div>
          <Link
            to="/login"
            className="bg-ledger hover:bg-ledger-strong inline-flex h-12 items-center rounded px-5 font-medium text-white"
          >
            Go to sign in
          </Link>
        </div>
      </div>
    </main>
  )
}

/** "Ayo Thrift Society Ltd" → "ayo-thrift-society". */
function suggestSlug(name: string) {
  return name
    .toLowerCase()
    .replace(/\b(ltd|limited|plc|nig|nigeria|enterprises?)\b/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .slice(0, 31)
    .replace(/-+$/, '')
}

function SignupForm({
  plans,
  trialDays,
  onDone,
}: {
  plans: Parameters<typeof PlanPicker>[0]['plans']
  trialDays: number
  onDone: (done: { trialEndsAt: string | null; email: string }) => void
}) {
  const [form, setForm] = useState<SignupRequest>({
    plan: plans[1]?.code ?? plans[0]?.code ?? '',
    slug: '',
    businessName: '',
    businessAddress: '',
    businessPhone: '',
    businessEmail: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
  })
  const [slugEdited, setSlugEdited] = useState(false)
  const [slugNote, setSlugNote] = useState<string | null>(null)
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)
  const set = (key: keyof SignupRequest) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setForm((f) => ({
      ...f,
      [key]: value,
      ...(key === 'businessName' && !slugEdited ? { slug: suggestSlug(value) } : {}),
    }))
  }

  const checkSlug = async () => {
    if (!form.slug) return
    try {
      const result = await signupApi.check(form.slug)
      setSlugNote(result.available ? `“${result.slug}” is free.` : null)
      setErrors((e) => ({
        ...e,
        slug: result.available ? undefined : (result.reason ?? undefined),
      }))
    } catch {
      setSlugNote(null)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const local: Errors = {}
    if (!PASSWORD_RULES.every((r) => r.test(form.password)))
      local.password = 'The password must meet all the requirements listed.'
    else if (confirm !== form.password) local.confirm = 'The passwords don’t match.'
    setErrors(local)
    if (Object.keys(local).length) return
    setBusy(true)
    try {
      const result = await signupApi.signup(form)
      onDone({
        trialEndsAt: result.trialEndsAt,
        email: form.email.trim().toLowerCase(),
      })
    } catch (err) {
      if (isApiError(err))
        setErrors({
          ...Object.fromEntries(Object.entries(err.fieldErrors).map(([k, v]) => [k, v.join(' ')])),
          form:
            err.formErrors.join(' ') ||
            (Object.keys(err.fieldErrors).length ? 'Some details need fixing.' : err.message),
        })
      else setErrors({ form: 'Sign-up didn’t go through. Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main>
      <h1 className="text-ink text-2xl font-semibold">Start your free trial</h1>
      <p className="text-ink-2 mt-1 max-w-2xl text-sm">
        EMS runs your cooperative or thrift business: customers, savings, thrift, loans, field
        collections and remittance, across every branch. Try it free for {trialDays} days. No card
        needed.
      </p>
      <form onSubmit={submit} noValidate className="mt-8 flex flex-col gap-8">
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <section>
          <h2 className="mb-3 text-base font-semibold">Choose a plan</h2>
          <PlanPicker
            plans={plans}
            value={form.plan}
            onChange={(plan) => setForm((f) => ({ ...f, plan }))}
            error={errors.plan}
          />
          <p className="text-ink-2 mt-2 text-sm">You can change plan at any time.</p>
        </section>

        <div className="border-rule bg-surface grid gap-8 rounded border p-6 sm:p-8 lg:max-w-3xl">
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-3 text-base font-semibold">Your business</legend>
            <TextInput
              label="Business name"
              containerClassName="sm:col-span-2"
              value={form.businessName}
              onChange={set('businessName')}
              error={errors.businessName}
            />
            <TextInput
              label="Short name"
              containerClassName="sm:col-span-2"
              value={form.slug}
              onChange={(e) => {
                setSlugEdited(true)
                setSlugNote(null)
                setForm((f) => ({ ...f, slug: e.target.value.toLowerCase() }))
              }}
              onBlur={() => void checkSlug()}
              error={errors.slug}
              hint={
                slugNote ??
                'Identifies your business in EMS, e.g. ayo-thrift. It can’t be changed later.'
              }
              autoCapitalize="none"
              spellCheck={false}
            />
            <TextInput
              label="Head office address"
              containerClassName="sm:col-span-2"
              value={form.businessAddress}
              onChange={set('businessAddress')}
              error={errors.businessAddress}
            />
            <TextInput
              label="Business phone"
              type="tel"
              value={form.businessPhone}
              onChange={set('businessPhone')}
              error={errors.businessPhone}
            />
            <TextInput
              label="Business email"
              type="email"
              optional
              value={form.businessEmail}
              onChange={set('businessEmail')}
              error={errors.businessEmail}
            />
          </fieldset>

          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-1 text-base font-semibold">Your account</legend>
            <p className="text-ink-2 -mt-2 text-sm sm:col-span-2">
              You’ll be the managing director in EMS, with every permission. You add the other
              staff.
            </p>
            <TextInput
              label="First name"
              value={form.firstName}
              onChange={set('firstName')}
              error={errors.firstName}
            />
            <TextInput
              label="Last name"
              value={form.lastName}
              onChange={set('lastName')}
              error={errors.lastName}
            />
            <TextInput
              label="Work email"
              type="email"
              value={form.email}
              onChange={set('email')}
              error={errors.email}
              hint="You sign in with it, and your sign-in codes and receipts are sent here."
            />
            <TextInput
              label="Mobile number"
              type="tel"
              value={form.phone}
              onChange={set('phone')}
              error={errors.phone}
              hint="So the business can reach you."
            />
            <div>
              <PasswordInput
                label="Password"
                autoComplete="new-password"
                value={form.password}
                onChange={set('password')}
                error={errors.password}
                aria-describedby="signup-password-rules"
              />
              <PasswordChecklist value={form.password} id="signup-password-rules" />
            </div>
            <PasswordInput
              label="Confirm password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              error={errors.confirm}
            />
          </fieldset>

          <div>
            <Button type="submit" variant="primary" size="lg" loading={busy}>
              Start free trial
            </Button>
          </div>
          <p className="text-ink-2 text-sm">
            Already use EMS?{' '}
            <Link to="/login" className="text-ink font-medium underline underline-offset-2">
              Sign in
            </Link>
          </p>
        </div>
      </form>
    </main>
  )
}
