import { Check, Circle } from 'lucide-react'
import { z } from 'zod'
import { cn } from '@/lib/cn'

export const PASSWORD_RULES = [
  { test: (v: string) => v.length >= 8, label: 'At least 8 characters' },
  { test: (v: string) => /[A-Z]/.test(v), label: 'A capital letter' },
  { test: (v: string) => /[a-z]/.test(v), label: 'A lowercase letter' },
  { test: (v: string) => /\d/.test(v), label: 'A number' },
] as const

export const newPasswordSchema = z
  .string()
  .min(1, 'Enter a new password.')
  .refine((v) => PASSWORD_RULES.every((r) => r.test(v)), {
    message: 'Your new password must meet all the requirements listed.',
  })

/** Live checklist under the new-password field. */
export function PasswordChecklist({ value, id }: { value: string; id?: string }) {
  return (
    <ul id={id} className="mt-1 grid gap-1 text-sm" aria-label="Password requirements">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(value)
        return (
          <li
            key={rule.label}
            className={cn('flex items-center gap-2', met ? 'text-ledger' : 'text-ink-3')}
          >
            {met ? (
              <Check className="size-4" aria-hidden />
            ) : (
              <Circle className="size-3.5" aria-hidden />
            )}
            {rule.label}
            <span className="sr-only">{met ? ' (done)' : ' (not yet)'}</span>
          </li>
        )
      })}
    </ul>
  )
}
