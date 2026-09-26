import {
  forwardRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { FormField, inputClasses } from './FormField'

interface CommonProps {
  label: ReactNode
  hint?: ReactNode
  error?: string
  optional?: boolean
  hideLabel?: boolean
  fieldSize?: 'md' | 'field'
  containerClassName?: string
}

export type TextInputProps = CommonProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  {
    label,
    hint,
    error,
    optional,
    hideLabel,
    fieldSize = 'md',
    containerClassName,
    className,
    id,
    ...props
  },
  ref,
) {
  return (
    <FormField
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      hideLabel={hideLabel}
      id={id}
      size={fieldSize}
      className={containerClassName}
    >
      {({ inputId, describedBy, invalid }) => (
        <input
          ref={ref}
          id={inputId}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(inputClasses(invalid, fieldSize), className)}
          {...props}
        />
      )}
    </FormField>
  )
})

export const PasswordInput = forwardRef<HTMLInputElement, Omit<TextInputProps, 'type'>>(
  function PasswordInput(
    {
      label,
      hint,
      error,
      optional,
      hideLabel,
      fieldSize = 'md',
      containerClassName,
      className,
      id,
      ...props
    },
    ref,
  ) {
    const [visible, setVisible] = useState(false)
    return (
      <FormField
        label={label}
        hint={hint}
        error={error}
        optional={optional}
        hideLabel={hideLabel}
        id={id}
        size={fieldSize}
        className={containerClassName}
      >
        {({ inputId, describedBy, invalid }) => (
          <div className="relative">
            <input
              ref={ref}
              id={inputId}
              type={visible ? 'text' : 'password'}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              className={cn(inputClasses(invalid, fieldSize), 'pr-16', className)}
              {...props}
            />
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              aria-pressed={visible}
              aria-controls={inputId}
              className="text-ink-2 hover:bg-ink-tint absolute inset-y-1 right-1 rounded-sm px-2.5 text-sm font-medium"
            >
              {visible ? 'Hide' : 'Show'}
              <span className="sr-only"> password</span>
            </button>
          </div>
        )}
      </FormField>
    )
  },
)

export type SelectProps = CommonProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { children: ReactNode }

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    hint,
    error,
    optional,
    hideLabel,
    fieldSize = 'md',
    containerClassName,
    className,
    id,
    children,
    ...props
  },
  ref,
) {
  return (
    <FormField
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      hideLabel={hideLabel}
      id={id}
      size={fieldSize}
      className={containerClassName}
    >
      {({ inputId, describedBy, invalid }) => (
        <div className="relative">
          <select
            ref={ref}
            id={inputId}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            className={cn(inputClasses(invalid, fieldSize), 'appearance-none pr-9', className)}
            {...props}
          >
            {children}
          </select>
          <ChevronDown
            className="text-ink-2 pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
            aria-hidden
          />
        </div>
      )}
    </FormField>
  )
})

export type TextAreaProps = CommonProps & TextareaHTMLAttributes<HTMLTextAreaElement>

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  {
    label,
    hint,
    error,
    optional,
    hideLabel,
    fieldSize = 'md',
    containerClassName,
    className,
    id,
    rows = 3,
    ...props
  },
  ref,
) {
  return (
    <FormField
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      hideLabel={hideLabel}
      id={id}
      size={fieldSize}
      className={containerClassName}
    >
      {({ inputId, describedBy, invalid }) => (
        <textarea
          ref={ref}
          id={inputId}
          rows={rows}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(inputClasses(invalid, fieldSize), 'h-auto py-2', className)}
          {...props}
        />
      )}
    </FormField>
  )
})

/** 6-digit one-time code: numeric keypad on phones, SMS autofill where supported. */
export const OtpInput = forwardRef<HTMLInputElement, Omit<TextInputProps, 'type' | 'inputMode'>>(
  function OtpInput({ className, ...props }, ref) {
    return (
      <TextInput
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        className={cn('tabular h-14 font-mono text-xl tracking-[0.5em]', className)}
        {...props}
      />
    )
  },
)

export function Checkbox({
  label,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode }) {
  return (
    <label
      className={cn('text-ink inline-flex cursor-pointer items-center gap-2 text-sm', className)}
    >
      <input type="checkbox" className="accent-ledger size-4" {...props} />
      {label}
    </label>
  )
}
