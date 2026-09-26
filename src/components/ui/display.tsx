import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatNaira, type Kobo } from '@/lib/money'

/** Amount with tabular figures; negative values in Brick. */
export function Money({
  value,
  className,
  signed,
}: {
  value: Kobo | null | undefined
  className?: string
  signed?: boolean
}) {
  if (value === null || value === undefined)
    return <span className={cn('text-ink-3', className)}>—</span>
  return (
    <span className={cn('tabular whitespace-nowrap', value < 0 && 'text-brick', className)}>
      {formatNaira(value, { signed })}
    </span>
  )
}

/** Label/value pairs in a responsive grid. */
export function DescriptionList({
  items,
  columns = 2,
}: {
  items: { label: string; value: ReactNode; wide?: boolean }[]
  columns?: 1 | 2 | 3
}) {
  return (
    <dl
      className={cn(
        'grid gap-x-6 gap-y-3',
        columns === 3 ? 'sm:grid-cols-3' : columns === 2 ? 'sm:grid-cols-2' : '',
      )}
    >
      {items.map((item) => (
        <div key={item.label} className={cn('min-w-0', item.wide && 'sm:col-span-full')}>
          <dt className="text-ink-2 text-xs font-medium">{item.label}</dt>
          <dd className="text-ink mt-0.5 text-sm break-words">
            {item.value || <span className="text-ink-3">—</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Bordered section with a heading row and optional actions. */
export function Panel({
  title,
  actions,
  children,
  className,
  flush,
}: {
  title: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  /** No inner padding (for tables and lists). */
  flush?: boolean
}) {
  return (
    <section className={cn('border-rule bg-surface rounded border', className)}>
      <header className="border-rule flex min-h-11 items-center justify-between gap-3 border-b px-4 py-2">
        <h2 className="text-ink text-sm font-semibold">{title}</h2>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </header>
      <div className={cn(!flush && 'p-4')}>{children}</div>
    </section>
  )
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="text-ink-2 hover:text-ink mb-3 inline-flex items-center gap-1.5 text-sm font-medium"
    >
      <ArrowLeft className="size-4" aria-hidden />
      {children}
    </Link>
  )
}

export function ProgressBar({
  value,
  max,
  label,
  tone = 'ledger',
}: {
  value: number
  max: number
  label: string
  tone?: 'ledger' | 'ink'
}) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100))
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="bg-ink-tint h-3 w-full overflow-hidden rounded-full"
    >
      <div
        className={cn('h-full rounded-full', tone === 'ledger' ? 'bg-ledger' : 'bg-ink')}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export function Initials({
  name,
  src,
  size = 'md',
}: {
  name: string
  src?: string | null
  size?: 'md' | 'lg'
}) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
  const box = size === 'lg' ? 'size-20 text-xl' : 'size-10 text-sm'
  if (src)
    return (
      <img
        src={src}
        alt={`Photo of ${name}`}
        className={cn(box, 'shrink-0 rounded object-cover')}
      />
    )
  return (
    <span
      className={cn(
        box,
        'bg-ink-tint text-ink-2 flex shrink-0 items-center justify-center rounded font-semibold',
      )}
      aria-hidden
    >
      {initials}
    </span>
  )
}
