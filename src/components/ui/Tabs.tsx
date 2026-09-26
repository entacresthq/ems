import { useRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface TabItem<T extends string> {
  value: T
  label: ReactNode
  count?: number
}

/** Tab strip with arrow-key movement. Content is rendered by the caller. */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: TabItem<T>[]
  value: T
  onChange: (value: T) => void
  label: string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  return (
    <div
      role="tablist"
      aria-label={label}
      className="border-rule flex gap-1 overflow-x-auto border-b"
    >
      {items.map((item, i) => {
        const selected = item.value === value
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => {
              const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
              if (!dir) return
              const next = (i + dir + items.length) % items.length
              refs.current[next]?.focus()
              onChange(items[next]!.value)
            }}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm whitespace-nowrap',
              selected
                ? 'border-ink text-ink font-semibold'
                : 'text-ink-2 hover:text-ink border-transparent',
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span
                className={cn(
                  'tabular rounded-sm px-1.5 text-xs',
                  selected ? 'bg-ink text-white' : 'bg-ink-tint text-ink-2',
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Two to four large options, one chosen. Used for cash/transfer in the field. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
}: {
  options: { value: T; label: ReactNode }[]
  value: T
  onChange: (value: T) => void
  label: string
  size?: 'md' | 'xl'
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-2">
      {options.map((o) => {
        const checked = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex items-center justify-center gap-2 rounded border-2 font-semibold',
              size === 'xl' ? 'text-field h-14' : 'h-10 text-sm',
              checked ? 'border-ink bg-ink text-white' : 'border-rule-strong bg-surface text-ink',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
