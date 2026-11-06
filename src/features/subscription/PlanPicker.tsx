import { Check } from 'lucide-react'
import type { Plan } from '@/api/subscription'
import { Badge } from '@/components/ui/StatusBadge'
import { cn } from '@/lib/cn'
import { formatNaira } from '@/lib/money'

/** The plans as radio cards: price a month, branch limit and selling points. */
export function PlanPicker({
  plans,
  value,
  onChange,
  current,
  name = 'plan',
  error,
}: {
  plans: Plan[]
  value: string
  onChange: (code: string) => void
  /** Marks the plan the business is on now. */
  current?: string
  name?: string
  error?: string
}) {
  return (
    <fieldset>
      <legend className="sr-only">Plan</legend>
      <div className="grid gap-3 md:grid-cols-3">
        {plans.map((plan) => {
          const selected = plan.code === value
          return (
            <label
              key={plan.code}
              className={cn(
                'bg-surface flex cursor-pointer flex-col rounded border p-4 transition-colors',
                selected
                  ? 'border-ledger ring-ledger ring-1'
                  : 'border-rule hover:border-rule-strong',
              )}
            >
              <input
                type="radio"
                name={name}
                value={plan.code}
                checked={selected}
                onChange={() => onChange(plan.code)}
                className="sr-only"
              />
              <span className="flex items-start justify-between gap-2">
                <span className="text-ink font-semibold">{plan.name}</span>
                {current === plan.code && <Badge tone="info">Current</Badge>}
                {selected && current !== plan.code && (
                  <Check className="text-ledger size-5" aria-hidden />
                )}
              </span>
              <span className="mt-2">
                <span className="tabular text-ink text-xl font-semibold">
                  {formatNaira(plan.monthlyPrice, { trimZeroKobo: true })}
                </span>
                <span className="text-ink-2 text-sm"> a month</span>
              </span>
              <span className="text-ink-2 mt-1 text-sm">
                {plan.maxBranches === null
                  ? 'Unlimited branches'
                  : plan.maxBranches === 1
                    ? '1 branch'
                    : `Up to ${plan.maxBranches} branches`}
              </span>
              {plan.features.length > 0 && (
                <ul className="text-ink-2 mt-3 flex flex-col gap-1.5 text-sm">
                  {plan.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check className="text-ledger mt-0.5 size-4 shrink-0" aria-hidden />
                      {f}
                    </li>
                  ))}
                </ul>
              )}
            </label>
          )
        })}
      </div>
      {error && <p className="text-brick mt-2 text-sm">{error}</p>}
    </fieldset>
  )
}
