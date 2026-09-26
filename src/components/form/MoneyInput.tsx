import { forwardRef, useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { formatNairaInput, parseNairaInput, type Kobo } from '@/lib/money'
import { FormField, inputClasses } from './FormField'

export interface MoneyInputProps {
  label: ReactNode
  value: Kobo | null
  onChange: (value: Kobo | null) => void
  onBlur?: () => void
  name?: string
  hint?: ReactNode
  error?: string
  optional?: boolean
  disabled?: boolean
  /** "amount" is the large field-app style for recording collections. */
  variant?: 'md' | 'amount'
  id?: string
  autoFocus?: boolean
}

/**
 * Naira amount entry. Accepts "1250000", "1,250,000" or "1250000.50", shows
 * grouping when the field loses focus, and reports integer kobo (or null).
 */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  {
    label,
    value,
    onChange,
    onBlur,
    name,
    hint,
    error,
    optional,
    disabled,
    variant = 'md',
    id,
    autoFocus,
  },
  ref,
) {
  const [text, setText] = useState(() => (value === null ? '' : formatNairaInput(value)))
  const [focused, setFocused] = useState(false)

  // Follow outside changes (e.g. a prefilled amount) while not editing.
  useEffect(() => {
    if (!focused) setText(value === null ? '' : formatNairaInput(value))
  }, [value, focused])

  const large = variant === 'amount'

  return (
    <FormField
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      id={id}
      size={large ? 'field' : 'md'}
    >
      {({ inputId, describedBy, invalid }) => (
        <div className="relative">
          <span
            aria-hidden
            className={cn(
              'text-ink-2 pointer-events-none absolute top-1/2 -translate-y-1/2 font-medium',
              large ? 'text-amount-sm left-4' : 'left-3 text-sm',
            )}
          >
            ₦
          </span>
          <input
            ref={ref}
            id={inputId}
            name={name}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            autoFocus={autoFocus}
            disabled={disabled}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={text}
            onFocus={() => {
              setFocused(true)
              setText((t) => t.replace(/,/g, ''))
            }}
            onChange={(e) => {
              const next = e.target.value.replace(/[^\d.,]/g, '')
              setText(next)
              onChange(parseNairaInput(next))
            }}
            onBlur={() => {
              setFocused(false)
              const parsed = parseNairaInput(text)
              setText(parsed === null ? text : formatNairaInput(parsed))
              onBlur?.()
            }}
            className={cn(
              inputClasses(invalid, large ? 'field' : 'md'),
              'tabular',
              large ? 'text-amount h-20 pl-12 font-semibold' : 'pl-7 text-right',
            )}
          />
        </div>
      )}
    </FormField>
  )
})
