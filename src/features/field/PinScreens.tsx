import { useState } from 'react'
import { Logo } from '@/components/ui/Logo'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useAuth, useCurrentUser } from '@/features/auth/AuthProvider'
import { checkPin, pinWeakness, savePin } from './pin'
import { PinPad } from './PinPad'

function PinFrame({
  title,
  intro,
  children,
  footer,
}: {
  title: string
  intro: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  useDocumentTitle(title)
  return (
    <div className="flex min-h-dvh flex-col bg-white px-4 pt-8 pb-6">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <Logo withName={false} />
        <h1 className="text-ink mt-6 text-xl font-semibold">{title}</h1>
        <p className="text-field text-ink-2 mt-1">{intro}</p>
        <div className="mt-8">{children}</div>
        {footer && <div className="mt-auto pt-8 text-center">{footer}</div>}
      </main>
    </div>
  )
}

/**
 * Choose a new PIN (enter, then confirm). With `requireCurrent`, the current
 * PIN is checked first — used for "Change PIN".
 */
export function PinSetupScreen({
  onDone,
  onCancel,
  requireCurrent = false,
}: {
  onDone: () => void
  onCancel?: () => void
  requireCurrent?: boolean
}) {
  const user = useCurrentUser()
  const { logout } = useAuth()
  const [step, setStep] = useState<'current' | 'choose' | 'confirm'>(
    requireCurrent ? 'current' : 'choose',
  )
  const [value, setValue] = useState('')
  const [first, setFirst] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const complete = async (pin: string) => {
    if (step === 'current') {
      setBusy(true)
      const result = await checkPin(user.id, pin)
      setBusy(false)
      setValue('')
      if (result.ok) {
        setError(null)
        setStep('choose')
      } else if (result.attemptsLeft === 0) {
        await logout('Too many wrong PIN attempts. Sign in with your password, then set a new PIN.')
      } else {
        setError(
          `Wrong PIN. ${result.attemptsLeft} ${result.attemptsLeft === 1 ? 'attempt' : 'attempts'} left.`,
        )
      }
      return
    }
    if (step === 'choose') {
      const weakness = pinWeakness(pin)
      setValue('')
      if (weakness) {
        setError(weakness)
        return
      }
      setError(null)
      setFirst(pin)
      setStep('confirm')
      return
    }
    if (pin !== first) {
      setValue('')
      setFirst('')
      setStep('choose')
      setError("The PINs didn't match. Choose your PIN again.")
      return
    }
    setBusy(true)
    await savePin(user.id, pin)
    setBusy(false)
    onDone()
  }

  const labels = {
    current: 'Enter your current PIN',
    choose: 'Choose a 6-digit PIN',
    confirm: 'Enter the same PIN again',
  }

  return (
    <PinFrame
      title={requireCurrent ? 'Change your PIN' : 'Set up your PIN'}
      intro={
        requireCurrent
          ? 'Confirm your current PIN, then choose a new one.'
          : `Hi ${user.firstName}. You'll use this PIN to open the app on this phone, even without network. Don't share it.`
      }
      footer={
        onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="text-field text-ink font-medium underline underline-offset-2"
          >
            Cancel
          </button>
        ) : undefined
      }
    >
      <PinPad
        label={labels[step]}
        value={value}
        onChange={(v) => {
          setValue(v)
          if (v.length > 0 && error && step !== 'current') setError(null)
        }}
        onComplete={complete}
        disabled={busy}
        error={error}
      />
    </PinFrame>
  )
}

export function PinLockScreen({ onUnlock }: { onUnlock: () => void }) {
  const user = useCurrentUser()
  const { logout } = useAuth()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const complete = async (pin: string) => {
    setBusy(true)
    const result = await checkPin(user.id, pin)
    setBusy(false)
    setValue('')
    if (result.ok) {
      onUnlock()
    } else if (result.attemptsLeft === 0) {
      await logout('Too many wrong PIN attempts. Sign in with your password, then set a new PIN.')
    } else {
      setError(
        `Wrong PIN. ${result.attemptsLeft} ${result.attemptsLeft === 1 ? 'attempt' : 'attempts'} left before you must sign in again.`,
      )
    }
  }

  return (
    <PinFrame
      title="Enter your PIN"
      intro={`Welcome back, ${user.firstName}. The app locked to keep your customers' details safe.`}
      footer={
        <button
          type="button"
          onClick={() => void logout()}
          className="text-field text-ink font-medium underline underline-offset-2"
        >
          Forgot PIN? Sign in with your password
        </button>
      }
    >
      <PinPad
        label="Your 6-digit PIN"
        value={value}
        onChange={setValue}
        onComplete={complete}
        disabled={busy}
        error={error}
      />
    </PinFrame>
  )
}
