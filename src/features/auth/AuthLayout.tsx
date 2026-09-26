import type { ReactNode } from 'react'
import { Logo } from '@/components/ui/Logo'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { cn } from '@/lib/cn'

export type AuthVariant = 'office' | 'field'

/** Frame for sign-in screens. The field variant is full-screen and larger for phones. */
export function AuthLayout({
  variant = 'office',
  title,
  description,
  children,
  aside,
}: {
  variant?: AuthVariant
  title: string
  description?: ReactNode
  children: ReactNode
  aside?: ReactNode
}) {
  useDocumentTitle(title)
  const field = variant === 'field'
  return (
    <div className={cn('min-h-dvh', field ? 'bg-white' : 'bg-paper')}>
      <div
        className={cn(
          'mx-auto flex min-h-dvh w-full flex-col px-4',
          field
            ? 'max-w-md pt-10 pb-8'
            : 'max-w-5xl justify-center py-10 lg:flex-row lg:items-start lg:gap-10',
        )}
      >
        <main className={cn('w-full', !field && 'mx-auto max-w-sm lg:mx-0 lg:pt-8')}>
          <Logo className="mb-8" withProduct />
          <div className={cn(!field && 'border-rule bg-surface rounded border p-6 sm:p-8')}>
            <h1 className={cn('text-ink font-semibold', field ? 'text-xl' : 'text-lg')}>{title}</h1>
            {description && (
              <p className={cn('text-ink-2 mt-1', field ? 'text-field' : 'text-sm')}>
                {description}
              </p>
            )}
            <div className="mt-6">{children}</div>
          </div>
        </main>
        {aside && (
          <aside
            className={cn(
              'w-full',
              field ? 'mt-8' : 'mx-auto mt-8 max-w-sm lg:mx-0 lg:mt-24 lg:max-w-xs',
            )}
          >
            {aside}
          </aside>
        )}
      </div>
    </div>
  )
}
