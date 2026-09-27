import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { Logo } from '@/components/ui/Logo'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { cn } from '@/lib/cn'

const STEPS = ['Activate', 'Set up', 'Sign in'] as const

/** Frame for the first-run screens of the desktop app. */
export function SetupLayout({
  step,
  title,
  description,
  children,
  aside,
}: {
  step: 0 | 1 | 2
  title: string
  description?: ReactNode
  children: ReactNode
  aside?: ReactNode
}) {
  useDocumentTitle(title)
  return (
    <div className="bg-paper min-h-dvh">
      <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 py-10">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <Logo withProduct />
          <ol className="flex items-center gap-2 text-sm" aria-label="Set-up steps">
            {STEPS.map((label, i) => (
              <li key={label} className="flex items-center gap-2">
                {i > 0 && <span className="bg-rule h-px w-6" aria-hidden />}
                <span
                  className={cn(
                    'flex size-6 items-center justify-center rounded-full text-xs font-semibold',
                    i < step && 'bg-ledger text-white',
                    i === step && 'bg-ink text-white',
                    i > step && 'border-rule-strong text-ink-3 border',
                  )}
                  aria-hidden
                >
                  {i < step ? <Check className="size-3.5" /> : i + 1}
                </span>
                <span className={cn(i === step ? 'text-ink font-medium' : 'text-ink-2')}>
                  {label}
                  <span className="sr-only">
                    {i < step ? ' (done)' : i === step ? ' (current step)' : ''}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
          <main className="border-rule bg-surface w-full rounded border p-6 sm:p-8 lg:max-w-2xl">
            <h1 className="text-ink text-xl font-semibold">{title}</h1>
            {description && <p className="text-ink-2 mt-1 text-sm">{description}</p>}
            <div className="mt-6">{children}</div>
          </main>
          {aside && <aside className="w-full lg:max-w-xs lg:pt-2">{aside}</aside>}
        </div>
      </div>
    </div>
  )
}
