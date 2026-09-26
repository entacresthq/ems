import { useId, type ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface FieldIds {
  inputId: string
  describedBy: string | undefined
  invalid: boolean
}

export interface FormFieldProps {
  label: ReactNode
  hint?: ReactNode
  error?: string
  /** Shows "(optional)" after the label. Required is the default and is not marked. */
  optional?: boolean
  id?: string
  className?: string
  /** Visually hide the label (it stays available to screen readers). */
  hideLabel?: boolean
  size?: 'md' | 'field'
  children: (ids: FieldIds) => ReactNode
}

/** Label above, control, then hint and error — the same structure for every field. */
export function FormField({
  label,
  hint,
  error,
  optional,
  id,
  className,
  hideLabel,
  size = 'md',
  children,
}: FormFieldProps) {
  const generated = useId()
  const inputId = id ?? generated
  const hintId = hint ? `${inputId}-hint` : undefined
  const errorId = error ? `${inputId}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={inputId}
        className={cn(
          'text-ink font-medium',
          size === 'field' ? 'text-field' : 'text-sm',
          hideLabel && 'sr-only',
        )}
      >
        {label}
        {optional && <span className="text-ink-3 font-normal"> (optional)</span>}
      </label>
      {children({ inputId, describedBy, invalid: Boolean(error) })}
      {hint && !error && (
        <p id={hintId} className="text-ink-3 text-sm">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-brick flex items-start gap-1.5 text-sm font-medium">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}

export function inputClasses(invalid: boolean, size: 'md' | 'field' = 'md') {
  return cn(
    'w-full rounded border bg-surface text-ink placeholder:text-ink-3',
    'focus:border-ink focus:outline-2 focus:outline-offset-0 focus:outline-ink',
    'disabled:cursor-not-allowed disabled:bg-ink-tint disabled:text-ink-3',
    size === 'field' ? 'h-14 px-4 text-field' : 'h-10 px-3 text-base sm:text-sm',
    invalid ? 'border-brick focus:border-brick focus:outline-brick' : 'border-rule-strong',
  )
}
