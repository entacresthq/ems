import { useEffect, useRef, useState, type ReactNode, type SelectHTMLAttributes } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'

/** Row of compact filters that wraps on small screens. */
export function FilterBar({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      {children}
      {actions && <div className="ml-auto flex flex-wrap items-end gap-2">{actions}</div>}
    </div>
  )
}

/** Search box that waits for a pause in typing before searching. */
export function SearchBox({
  value,
  onChange,
  label,
  placeholder,
  className,
}: {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder?: string
  className?: string
}) {
  const [text, setText] = useState(value)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // Keep in step when the URL changes (e.g. "Clear filters").
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    setText(value)
  }

  useEffect(() => {
    if (text === value) return
    const timer = setTimeout(() => onChangeRef.current(text.trim()), 350)
    return () => clearTimeout(timer)
  }, [text, value])

  return (
    <label className={cn('flex min-w-56 flex-1 flex-col gap-1 sm:max-w-sm', className)}>
      <span className="text-ink-2 text-xs font-medium">{label}</span>
      <span className="relative">
        <Search
          className="text-ink-3 pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          aria-hidden
        />
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          className="border-rule-strong bg-surface placeholder:text-ink-3 focus:border-ink focus:outline-ink h-9 w-full rounded border pr-8 pl-8 text-sm focus:outline-2 focus:outline-offset-0"
        />
        {text && (
          <button
            type="button"
            onClick={() => {
              setText('')
              onChange('')
            }}
            className="text-ink-2 hover:bg-ink-tint absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1"
            aria-label="Clear search"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </span>
    </label>
  )
}

export function FilterSelect({
  label,
  children,
  className,
  ...props
}: { label: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="text-ink-2 text-xs font-medium">{label}</span>
      <span className="relative">
        <select
          className="border-rule-strong bg-surface focus:border-ink focus:outline-ink h-9 w-full min-w-36 appearance-none rounded border pr-8 pl-2.5 text-sm focus:outline-2 focus:outline-offset-0"
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          className="text-ink-2 pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2"
          aria-hidden
        />
      </span>
    </label>
  )
}

export function FilterDate({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-ink-2 text-xs font-medium">{label}</span>
      <input
        type="date"
        className="border-rule-strong bg-surface focus:border-ink focus:outline-ink h-9 rounded border px-2.5 text-sm focus:outline-2 focus:outline-offset-0"
        {...props}
      />
    </label>
  )
}
