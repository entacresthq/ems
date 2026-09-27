import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { isApiError } from '@/api/client'
import { systemApi, systemKeys, type OnboardingRequest, type SystemStatus } from '@/api/system'
import { PasswordInput, TextInput } from '@/components/form/inputs'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { PasswordChecklist, PASSWORD_RULES } from '@/features/auth/passwordRules'
import { config } from '@/config'
import { formatDate } from '@/lib/dates'
import { SetupLayout } from './SetupLayout'

type Errors = Record<string, string>

/** First run after activation: the business, the MD's account and the starting data. */
export function OnboardingScreen({ status }: { status: SystemStatus }) {
  const licence = status.licence
  const [business, setBusiness] = useState<OnboardingRequest['business']>({
    name: licence?.licensee ?? '',
    address: '',
    phone: '',
    email: '',
  })
  const [md, setMd] = useState<OnboardingRequest['md']>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
  })
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ email: string } | null>(null)
  const queryClient = useQueryClient()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const local: Errors = {}
    if (!PASSWORD_RULES.every((r) => r.test(md.password)))
      local['md.password'] = 'The password must meet all the requirements listed.'
    else if (confirm !== md.password) local.confirm = 'The passwords don’t match.'
    setErrors(local)
    if (Object.keys(local).length) return
    setBusy(true)
    try {
      setDone(await systemApi.onboard({ business, md, sampleData: false }))
    } catch (err) {
      if (isApiError(err))
        setErrors({
          ...Object.fromEntries(Object.entries(err.fieldErrors).map(([k, v]) => [k, v.join(' ')])),
          form: err.formErrors.join(' '),
        })
      else setErrors({ form: 'EMS couldn’t save the set-up. Try again.' })
    } finally {
      setBusy(false)
    }
  }

  if (done)
    return (
      <SetupLayout
        step={2}
        title="EMS is ready"
        description={`Sign in as ${done.email} with the password you just chose.`}
      >
        <div className="flex flex-col gap-4 text-sm">
          <p>
            Each sign-in also needs a 6-digit code sent by text message.{' '}
            {status.sms !== 'outbox' ? null : config.desktop ? (
              <>
                Until an SMS provider is connected, the code appears in a notification on this
                computer and under <strong>File → SMS outbox</strong>.
              </>
            ) : (
              <>
                SMS isn’t connected yet, so codes are only kept in the server’s SMS outbox. Connect
                an SMS provider before staff start using EMS.
              </>
            )}
          </p>
          <p>
            Next, add your branches, then your staff, thrift plans and loan products. You’ll find
            them under Administration and Lending.
          </p>
          {config.desktop && (
            <Alert tone="info">
              To practise first, open the demo workspace from <strong>File → Demo workspace</strong>
              . It has sample branches, staff and customers and never touches your live data.
            </Alert>
          )}
          <div>
            <Button
              variant="primary"
              size="lg"
              onClick={() => void queryClient.invalidateQueries({ queryKey: systemKeys.status })}
            >
              Go to sign in
            </Button>
          </div>
        </div>
      </SetupLayout>
    )

  const b = (k: keyof OnboardingRequest['business']) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setBusiness((x) => ({ ...x, [k]: e.target.value }))
  const m = (k: keyof OnboardingRequest['md']) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setMd((x) => ({ ...x, [k]: e.target.value }))

  return (
    <SetupLayout
      step={1}
      title="Set up EMS"
      description="Tell us about the business and create the managing director’s account. You can change the business details later in Settings."
      aside={
        licence && (
          <div className="text-sm">
            <h2 className="font-semibold">Your licence</h2>
            <dl className="text-ink-2 mt-2 grid gap-1">
              <div>
                <dt className="sr-only">Licence number</dt>
                <dd className="text-ink font-mono">{licence.id}</dd>
              </div>
              <div>
                <dt className="inline">Licensed to </dt>
                <dd className="text-ink inline">{licence.licensee}</dd>
              </div>
              <div>
                <dt className="inline">Branches: </dt>
                <dd className="text-ink inline">{licence.branches ?? 'Unlimited'}</dd>
              </div>
              <div>
                <dt className="inline">Valid until </dt>
                <dd className="text-ink inline">
                  {licence.expires ? formatDate(licence.expires) : 'no end date'}
                </dd>
              </div>
            </dl>
          </div>
        )
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-8">
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-base font-semibold">The business</legend>
          <TextInput
            label="Business name"
            containerClassName="sm:col-span-2"
            value={business.name}
            onChange={b('name')}
            error={errors['business.name']}
            hint="Printed on reports and receipts."
          />
          <TextInput
            label="Head office address"
            containerClassName="sm:col-span-2"
            value={business.address}
            onChange={b('address')}
            error={errors['business.address']}
          />
          <TextInput
            label="Phone"
            type="tel"
            value={business.phone}
            onChange={b('phone')}
            error={errors['business.phone']}
          />
          <TextInput
            label="Email"
            type="email"
            optional
            value={business.email}
            onChange={b('email')}
            error={errors['business.email']}
          />
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-1 text-base font-semibold">Managing director’s account</legend>
          <p className="text-ink-2 -mt-2 text-sm sm:col-span-2">
            The MD has every permission and adds the other staff.
          </p>
          <TextInput
            label="First name"
            value={md.firstName}
            onChange={m('firstName')}
            error={errors['md.firstName']}
          />
          <TextInput
            label="Last name"
            value={md.lastName}
            onChange={m('lastName')}
            error={errors['md.lastName']}
          />
          <TextInput
            label="Work email"
            type="email"
            value={md.email}
            onChange={m('email')}
            error={errors['md.email']}
            hint="Used to sign in."
          />
          <TextInput
            label="Mobile number"
            type="tel"
            value={md.phone}
            onChange={m('phone')}
            error={errors['md.phone']}
            hint="Sign-in codes are sent here."
          />
          <div>
            <PasswordInput
              label="Password"
              autoComplete="new-password"
              value={md.password}
              onChange={m('password')}
              error={errors['md.password']}
              aria-describedby="md-password-rules"
            />
            <PasswordChecklist value={md.password} id="md-password-rules" />
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
            Finish set-up
          </Button>
        </div>
      </form>
    </SetupLayout>
  )
}
