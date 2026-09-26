import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate } from 'react-router-dom'
import { authApi } from '@/api/auth'
import { applyServerErrors } from '@/api/forms'
import { PasswordInput } from '@/components/form/inputs'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { homePathFor, isFieldUser } from '@/lib/permissions'
import { AuthLayout } from './AuthLayout'
import { useAuth, useCurrentUser } from './AuthProvider'
import { newPasswordSchema, PasswordChecklist } from './passwordRules'

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: newPasswordSchema,
    confirmPassword: z.string().min(1, 'Type the new password again.'),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: "The passwords don't match. Type the same password in both fields.",
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ['newPassword'],
    message: 'Choose a password different from your current one.',
  })
type Values = z.infer<typeof schema>

/**
 * Used both for the forced change on first sign-in and for a voluntary change.
 * The forced version cannot be skipped: route guards send the user back here.
 */
export function ChangePasswordPage() {
  const user = useCurrentUser()
  const { updateUser, logout } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const forced = user.mustChangePassword
  const field = isFieldUser(user)
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })

  const onSubmit = handleSubmit(async ({ currentPassword, newPassword }) => {
    setFormError(null)
    try {
      const updated = await authApi.changePassword({ currentPassword, newPassword })
      updateUser(updated)
      toast({
        title: 'Password changed',
        description: 'Use your new password next time you sign in.',
      })
      navigate(homePathFor(updated), { replace: true })
    } catch (error) {
      setFormError(applyServerErrors(error, setError, ['currentPassword', 'newPassword']))
    }
  })

  return (
    <AuthLayout
      variant={field ? 'field' : 'office'}
      title={forced ? 'Set your own password' : 'Change your password'}
      description={
        forced
          ? `Welcome, ${user.firstName}. You signed in with a temporary password. Choose your own before you continue.`
          : 'Choose a password you don’t use anywhere else.'
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <PasswordInput
          label={forced ? 'Temporary password' : 'Current password'}
          autoComplete="current-password"
          fieldSize={field ? 'field' : 'md'}
          error={errors.currentPassword?.message}
          {...register('currentPassword')}
        />
        <div>
          <PasswordInput
            label="New password"
            autoComplete="new-password"
            fieldSize={field ? 'field' : 'md'}
            error={errors.newPassword?.message}
            {...register('newPassword')}
          />
          <PasswordChecklist value={watch('newPassword')} />
        </div>
        <PasswordInput
          label="Confirm new password"
          autoComplete="new-password"
          fieldSize={field ? 'field' : 'md'}
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <Button
          type="submit"
          variant={field ? 'ink' : 'primary'}
          size={field ? 'xl' : 'lg'}
          loading={isSubmitting}
          loadingLabel="Saving…"
          className="w-full"
        >
          Save new password
        </Button>
        {forced ? (
          <button
            type="button"
            onClick={() => void logout()}
            className="text-ink self-start text-sm font-medium underline underline-offset-2"
          >
            Sign out instead
          </button>
        ) : (
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="text-ink self-start text-sm font-medium underline underline-offset-2"
          >
            Cancel
          </button>
        )}
      </form>
    </AuthLayout>
  )
}
