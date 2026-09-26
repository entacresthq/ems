import type { ReactNode } from 'react'
import { isApiError } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/lib/cn'

export function LoadingState({
  label = 'Loading…',
  className,
}: {
  label?: string
  className?: string
}) {
  return (
    <div
      role="status"
      className={cn('text-ink-2 flex items-center justify-center gap-3 py-12 text-sm', className)}
    >
      <Spinner className="size-5" />
      {label}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string
  /** Tell the person what to do next. */
  description?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      {icon && <div className="text-ink-3 mb-3">{icon}</div>}
      <p className="text-ink text-base font-semibold">{title}</p>
      {description && <p className="text-ink-2 mt-1 max-w-md text-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({
  error,
  onRetry,
  title = "Couldn't load this",
  className,
}: {
  error: unknown
  onRetry?: () => void
  title?: string
  className?: string
}) {
  const message = isApiError(error)
    ? error.message
    : 'Something unexpected happened. Try again, and contact support if it keeps happening.'
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center px-6 py-12 text-center', className)}
    >
      <p className="text-brick text-base font-semibold">{title}</p>
      <p className="text-ink-2 mt-1 max-w-md text-sm">{message}</p>
      {onRetry && (
        <Button className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}
