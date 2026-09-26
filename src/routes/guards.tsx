import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Logo } from '@/components/ui/Logo'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/features/auth/AuthProvider'
import { ForbiddenPage } from '@/features/errors/ErrorPages'
import { hasPermission, homePathFor, isFieldUser } from '@/lib/permissions'
import type { Permission } from '@/types'

function SessionLoading() {
  return (
    <div
      className="bg-paper flex min-h-dvh flex-col items-center justify-center gap-4"
      role="status"
    >
      <Logo withProduct />
      <span className="text-ink-2 flex items-center gap-2 text-sm">
        <Spinner /> Checking your session…
      </span>
    </div>
  )
}

/** Signed-in users only. Sends first-time users to set their password. */
export function RequireAuth() {
  const { state } = useAuth()
  const location = useLocation()
  if (state.status === 'loading') return <SessionLoading />
  if (state.status === 'anonymous') {
    const loginPath = location.pathname.startsWith('/field') ? '/field/login' : '/login'
    return <Navigate to={loginPath} replace state={{ from: location.pathname + location.search }} />
  }
  if (state.user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }
  return <Outlet />
}

/** Sign-in screens: already signed-in users go straight to their home. */
export function GuestOnly() {
  const { state } = useAuth()
  if (state.status === 'loading') return <SessionLoading />
  if (state.status === 'authenticated') return <Navigate to={homePathFor(state.user)} replace />
  return <Outlet />
}

/** Officers use the field app; everyone else uses the back office. */
export function BackOfficeOnly() {
  const { user } = useAuth()
  if (user && isFieldUser(user)) return <Navigate to="/field/today" replace />
  return <Outlet />
}

export function FieldOnly() {
  const { user } = useAuth()
  if (user && !isFieldUser(user)) return <Navigate to="/" replace />
  return <Outlet />
}

export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission
  children: ReactNode
}) {
  const { user } = useAuth()
  if (!hasPermission(user, permission)) return <ForbiddenPage />
  return <>{children}</>
}
