import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { config } from '@/config'
import { useAuth, useCurrentUser } from '@/features/auth/AuthProvider'
import { hasPin } from './pin'
import { PinLockScreen, PinSetupScreen } from './PinScreens'

type LockState = 'needs_setup' | 'locked' | 'unlocked'

const FieldLockContext = createContext<{ lock: () => void } | null>(null)

/**
 * Gate for the field app: set up a PIN on first use, ask for it when the app
 * is reopened, and lock again after a few minutes of inactivity.
 */
export function FieldLockGate({ children }: { children: ReactNode }) {
  const user = useCurrentUser()
  const { state: auth } = useAuth()
  const justSignedIn = auth.status === 'authenticated' && auth.source === 'login'
  const [state, setState] = useState<LockState>(() =>
    !hasPin(user.id) ? 'needs_setup' : justSignedIn ? 'unlocked' : 'locked',
  )
  const lastActive = useRef(0)

  const lock = useCallback(() => setState(hasPin(user.id) ? 'locked' : 'needs_setup'), [user.id])

  useEffect(() => {
    if (state !== 'unlocked') return
    lastActive.current = Date.now()
    const touch = () => {
      lastActive.current = Date.now()
    }
    const check = () => {
      if (Date.now() - lastActive.current >= config.fieldLockMs) lock()
    }
    const onVisibility = () => {
      // Returning to the app after a long break locks it straight away.
      if (document.visibilityState === 'visible') check()
      else touch()
    }
    const events = ['pointerdown', 'keydown', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }))
    document.addEventListener('visibilitychange', onVisibility)
    const timer = window.setInterval(check, 15_000)
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch))
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(timer)
    }
  }, [state, lock])

  if (state === 'needs_setup') return <PinSetupScreen onDone={() => setState('unlocked')} />
  if (state === 'locked') return <PinLockScreen onUnlock={() => setState('unlocked')} />
  return <FieldLockContext.Provider value={{ lock }}>{children}</FieldLockContext.Provider>
}

export function useFieldLock() {
  const ctx = useContext(FieldLockContext)
  if (!ctx) throw new Error('useFieldLock must be used inside FieldLockGate')
  return ctx
}
