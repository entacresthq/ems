import { useEffect } from 'react'
import { Delete } from 'lucide-react'
import { config } from '@/config'
import { cn } from '@/lib/cn'

/**
 * Large on-screen keypad for the 6-digit PIN. Also accepts a hardware keyboard.
 * Calls onComplete once all digits are entered.
 */
export function PinPad({
  value,
  onChange,
  onComplete,
  disabled,
  error,
  label,
}: {
  value: string
  onChange: (value: string) => void
  onComplete: (value: string) => void
  disabled?: boolean
  error?: string | null
  label: string
}) {
  const length = config.pinLength

  const press = (digit: string) => {
    if (disabled || value.length >= length) return
    const next = value + digit
    onChange(next)
    if (next.length === length) onComplete(next)
  }
  const backspace = () => !disabled && onChange(value.slice(0, -1))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') backspace()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

  return (
    <div className="flex flex-col items-center">
      <p className="text-field text-ink font-medium">{label}</p>
      <div
        className="mt-4 flex gap-3"
        role="img"
        aria-label={`${value.length} of ${length} digits entered`}
      >
        {Array.from({ length }, (_, i) => (
          <span
            key={i}
            className={cn(
              'size-4 rounded-full border-2',
              error ? 'border-brick' : 'border-ink',
              i < value.length && (error ? 'bg-brick' : 'bg-ink'),
            )}
          />
        ))}
      </div>
      <p role="alert" className="text-field text-brick mt-3 min-h-6 text-center font-medium">
        {error}
      </p>
      <div className="mt-4 grid w-full max-w-xs grid-cols-3 gap-3">
        {keys.map((k) => (
          <KeyButton key={k} onClick={() => press(k)} disabled={disabled}>
            {k}
          </KeyButton>
        ))}
        <span />
        <KeyButton onClick={() => press('0')} disabled={disabled}>
          0
        </KeyButton>
        <KeyButton
          onClick={backspace}
          disabled={disabled || value.length === 0}
          aria-label="Delete last digit"
        >
          <Delete className="size-7" aria-hidden />
        </KeyButton>
      </div>
    </div>
  )
}

function KeyButton({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'bg-ink-tint text-amount-sm text-ink tabular flex h-16 items-center justify-center rounded font-medium',
        'active:bg-rule disabled:opacity-40',
        className,
      )}
      {...props}
    />
  )
}
