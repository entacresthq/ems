import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useSearchParams } from 'react-router-dom'
import { authApi } from '@/api/auth'
import { applyServerErrors } from '@/api/forms'
import { PasswordInput, TextInput } from '@/components/form/inputs'
import { Alert } from '@/components/ui/Alert'
import { Button, ButtonLink } from '@/components/ui/Button'
import { config } from '@/config'
import { AuthLayout } from './AuthLayout'
import { newPasswordSchema, PasswordChecklist } from './passwordRules'

const requestSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Enter your email address.')
    .email('Enter a valid email address, like name@ems.ng.'),
})

export function ResetPasswordRequestPage() {
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof requestSchema>>({ resolver: zodResolver(requestSchema) })

  const onSubmit = handleSubmit(async ({ email }) => {
    setFormError(null)
    try {
      await authApi.requestPasswordReset(email)
      setSentTo(email)
    } catch (error) {
      setFormError(applyServerErrors(error, setError, ['email']))
    }
  })

  if (sentTo) {
    // Demo only: the mock accepts token "demo" and the base64 email as uid.
    const demoLink = `/reset-password/confirm?uid=${btoa(sentTo)}&token=demo`
    return (
      <AuthLayout
        title="Check your email"
        description={`If ${sentTo} belongs to a staff account, we've sent a link to reset the password. The link works for 1 hour.`}
      >
        <div className="flex flex-col gap-4">
          {config.useMocks && (
            <Alert tone="info" title="Demo mode">
              No email is sent.{' '}
              <Link to={demoLink} className="font-medium underline">
                Open the reset link
              </Link>
              .
            </Alert>
          )}
          <p className="text-ink-2 text-sm">
            No email after a few minutes? Check your spam folder, or ask an administrator to reset
            your password.
          </p>
          <ButtonLink to="/login" size="lg" className="w-full">
            Back to sign in
          </ButtonLink>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Reset your password"
      description="Enter your staff email address and we'll send you a link to set a new password."
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <TextInput
          label="Email address"
          type="email"
          autoComplete="username"
          error={errors.email?.message}
          {...register('email')}
        />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={isSubmitting}
          loadingLabel="Sending…"
          className="w-full"
        >
          Send reset link
        </Button>
        <Link
          to="/login"
          className="text-ink self-start text-sm font-medium underline underline-offset-2"
        >
          Back to sign in
        </Link>
      </form>
    </AuthLayout>
  )
}

const confirmSchema = z
  .object({
    newPassword: newPasswordSchema,
    confirmPassword: z.string().min(1, 'Type the new password again.'),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: "The passwords don't match. Type the same password in both fields.",
  })

export function ResetPasswordConfirmPage() {
  const [params] = useSearchParams()
  const uid = params.get('uid') ?? ''
  const token = params.get('token') ?? ''
  const [done, setDone] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof confirmSchema>>({
    resolver: zodResolver(confirmSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  })

  const onSubmit = handleSubmit(async ({ newPassword }) => {
    setFormError(null)
    try {
      await authApi.confirmPasswordReset({ uid, token, newPassword })
      setDone(true)
    } catch (error) {
      setFormError(applyServerErrors(error, setError, ['newPassword']))
    }
  })

  if (!uid || !token) {
    return (
      <AuthLayout
        title="This link is incomplete"
        description="The reset link is missing some details. Open the link from the email again, or request a new one."
      >
        <ButtonLink to="/reset-password" size="lg" variant="primary" className="w-full">
          Request a new link
        </ButtonLink>
      </AuthLayout>
    )
  }

  if (done) {
    return (
      <AuthLayout
        title="Password changed"
        description="You can now sign in with your new password."
      >
        <ButtonLink to="/login" size="lg" variant="primary" className="w-full">
          Sign in
        </ButtonLink>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Set a new password"
      description="Choose a password you don't use anywhere else."
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError && (
          <Alert
            tone="danger"
            action={
              <Link to="/reset-password" className="font-medium underline">
                Request a new link
              </Link>
            }
          >
            {formError}
          </Alert>
        )}
        <div>
          <PasswordInput
            label="New password"
            autoComplete="new-password"
            error={errors.newPassword?.message}
            {...register('newPassword')}
          />
          <PasswordChecklist value={watch('newPassword')} />
        </div>
        <PasswordInput
          label="Confirm new password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={isSubmitting}
          loadingLabel="Saving…"
          className="w-full"
        >
          Set new password
        </Button>
      </form>
    </AuthLayout>
  )
}
