import type { ReactNode } from 'react'
import { hasPermission } from '@/lib/permissions'
import type { Permission } from '@/types'
import { useAuth } from './AuthProvider'

export function useCan() {
  const { user } = useAuth()
  return (permission: Permission) => hasPermission(user, permission)
}

/** Renders children only when the user has the permission. Actions are hidden, not disabled. */
export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission
  children: ReactNode
  fallback?: ReactNode
}) {
  const can = useCan()
  return <>{can(permission) ? children : fallback}</>
}
