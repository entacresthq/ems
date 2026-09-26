import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { authApi } from '@/api/auth'
import { isApiError, onSessionExpired, refreshAccessToken } from '@/api/client'
import { isFieldUser } from '@/lib/permissions'
import { queryClient } from '@/lib/queryClient'
import type { AuthUser } from '@/types'
import { hasPin } from '@/features/field/pin'
import { cacheFieldUser, clearCachedFieldUser, readCachedFieldUser } from './sessionCache'

export type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous'; notice?: string }
  | {
      status: 'authenticated'
      user: AuthUser
      /** Field app opened without network, using the cached profile. */
      offline: boolean
      /** 'login' right after password + OTP; 'restored' after a reload or reopen. */
      source: 'login' | 'restored'
    }

interface AuthContextValue {
  state: AuthState
  user: AuthUser | null
  /** Call after OTP verification succeeds. */
  completeLogin: (user: AuthUser) => void
  /** Replace the user after a profile or password change. */
  updateUser: (user: AuthUser) => void
  logout: (notice?: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  const endSession = useCallback((notice?: string) => {
    queryClient.clear()
    clearCachedFieldUser()
    setState({ status: 'anonymous', notice })
  }, [])

  // Restore the session from the refresh cookie on load.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const token = await refreshAccessToken()
        if (cancelled) return
        if (!token) {
          setState({ status: 'anonymous' })
          return
        }
        const user = await authApi.me()
        if (cancelled) return
        if (isFieldUser(user)) cacheFieldUser(user)
        setState({ status: 'authenticated', user, offline: false, source: 'restored' })
      } catch (error) {
        if (cancelled) return
        const cached = readCachedFieldUser()
        if (isApiError(error) && error.isNetworkError && cached && hasPin(cached.id)) {
          setState({ status: 'authenticated', user: cached, offline: true, source: 'restored' })
        } else {
          setState({ status: 'anonymous' })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    onSessionExpired(() => endSession('Your session has ended. Sign in again to continue.'))
    return () => onSessionExpired(null)
  }, [endSession])

  // An offline field session reconnects to the server when the network returns.
  const offline = state.status === 'authenticated' && state.offline
  useEffect(() => {
    if (!offline) return
    const reconnect = async () => {
      try {
        const token = await refreshAccessToken()
        if (!token) {
          endSession(
            'Your session ended while you were offline. Sign in again. Collections saved on this phone are kept.',
          )
          return
        }
        const user = await authApi.me()
        cacheFieldUser(user)
        setState((s) => (s.status === 'authenticated' ? { ...s, user, offline: false } : s))
      } catch {
        // Still no usable connection; try again on the next "online" event.
      }
    }
    window.addEventListener('online', reconnect)
    if (navigator.onLine) void reconnect()
    return () => window.removeEventListener('online', reconnect)
  }, [offline, endSession])

  const completeLogin = useCallback((user: AuthUser) => {
    if (isFieldUser(user)) cacheFieldUser(user)
    setState({ status: 'authenticated', user, offline: false, source: 'login' })
  }, [])

  const updateUser = useCallback((user: AuthUser) => {
    if (isFieldUser(user)) cacheFieldUser(user)
    setState((s) => (s.status === 'authenticated' ? { ...s, user } : s))
  }, [])

  const logout = useCallback(
    async (notice?: string) => {
      try {
        await authApi.logout()
      } catch {
        // Offline or server error: still end the session locally.
      }
      endSession(notice)
    },
    [endSession],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      user: state.status === 'authenticated' ? state.user : null,
      completeLogin,
      updateUser,
      logout,
    }),
    [state, completeLogin, updateUser, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

/** For screens that only render when signed in. */
export function useCurrentUser(): AuthUser {
  const { user } = useAuth()
  if (!user) throw new Error('useCurrentUser used without a signed-in user')
  return user
}
