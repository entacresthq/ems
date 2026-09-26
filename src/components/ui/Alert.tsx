import type { ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'

type AlertTone = 'danger' | 'warning' | 'success' | 'info'

const STYLES: Record<AlertTone, { box: string; icon: typeof Info }> = {
  danger: { box: 'border-brick bg-brick-tint text-brick-strong', icon: CircleAlert },
  warning: { box: 'border-ochre bg-ochre-tint text-ink', icon: TriangleAlert },
  success: { box: 'border-ledger bg-ledger-tint text-ink', icon: CircleCheck },
  info: { box: 'border-ink bg-surface text-ink', icon: Info },
}

/** Inline message with a strong left rule. Danger alerts are announced immediately. */
export function Alert({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: AlertTone
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  const { box, icon: Icon } = STYLES[tone]
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex gap-3 border-l-4 px-4 py-3 text-sm', box, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  )
}
