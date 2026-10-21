import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CircleCheck, CircleX } from 'lucide-react'
import { loanKeys, loansApi } from '@/api/loans'
import { ErrorState, LoadingState } from '@/components/states'
import { Badge } from '@/components/ui/StatusBadge'
import { Panel } from '@/components/ui/display'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { cn } from '@/lib/cn'
import { ACTIVITY_WINDOW_DAYS, monthlyInflow } from '@/lib/eligibility'
import { formatNaira, type Kobo } from '@/lib/money'
import { hasPermission } from '@/lib/permissions'
import type {
  Customer,
  EligibilityCheck,
  EligibilityReport,
  LoanEligibilitySnapshot,
  ProductEligibility,
} from '@/types'

const money = (k: Kobo) => formatNaira(k, { trimZeroKobo: true })

export function useEligibility(customerId: string, topUpId: string | null = null) {
  return useQuery({
    queryKey: loanKeys.eligibility(customerId, topUpId),
    queryFn: () => loansApi.eligibility(customerId, topUpId),
  })
}

export function CheckList({ checks }: { checks: EligibilityCheck[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {checks.map((c) => (
        <li
          key={c.key}
          className={cn(
            'flex items-start gap-2 text-sm',
            c.passed ? 'text-ink' : 'text-brick font-medium',
          )}
        >
          {c.passed ? (
            <CircleCheck className="text-ledger mt-0.5 size-4 shrink-0" aria-hidden />
          ) : (
            <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden />
          )}
          <span>
            {c.label}
            <span className={cn('block text-xs', c.passed ? 'text-ink-2' : 'text-brick')}>
              {c.detail}
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Savings, regular saving and monthly inflow: what the amounts are worked out from. */
export function EligibilityFactsLine({ report }: { report: EligibilityReport }) {
  const { facts } = report
  return (
    <p className="text-ink-2 text-sm">
      {money(facts.savingsBalance)} saved · {facts.depositsInWindow} deposits in the last{' '}
      {facts.windowDays || ACTIVITY_WINDOW_DAYS} days · about {money(monthlyInflow(facts))} paid in
      a month
      {facts.closedLoans > 0 &&
        ` · ${facts.closedLoans} loan${facts.closedLoans > 1 ? 's' : ''} repaid`}
    </p>
  )
}

/** The checks every product shares (not the guarantor or amount, which depend on the product). */
export const commonChecks = (result: ProductEligibility) =>
  result.checks.filter((c) => c.key !== 'amount' && c.key !== 'guarantor')

function reasonFor(result: ProductEligibility) {
  const failed = result.checks.find((c) => !c.passed)
  return failed ? `${failed.label}: ${failed.detail}` : null
}

/** On the customer's page: which products they qualify for and how much. */
export function CustomerEligibilityPanel({ customer }: { customer: Customer }) {
  const user = useCurrentUser()
  const query = useEligibility(customer.id)
  const canApply = hasPermission(user, 'loans.apply')
  return (
    <Panel title="Loan eligibility">
      {query.isPending ? (
        <LoadingState label="Checking…" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          {!query.data.policy.enabled && (
            <p className="text-ink-2 text-sm">
              The lending policy is switched off. Only the product rules are checked.
            </p>
          )}
          <EligibilityFactsLine report={query.data} />
          {query.data.products.length === 0 ? (
            <p className="text-ink-2 text-sm">No active loan products.</p>
          ) : (
            <ul className="divide-rule border-rule divide-y border-y">
              {query.data.products.map((p) => (
                <li key={p.productId} className="flex items-start justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block font-medium">{p.productName}</span>
                    <span className="text-ink-2 block text-xs">
                      {p.qualified
                        ? `Over ${p.installmentCount} installments, limited by ${p.limits.find((l) => l.key === p.limitedBy)?.label.toLowerCase()}.`
                        : reasonFor(p)}
                    </span>
                  </span>
                  {p.qualified ? (
                    <Badge tone="success">Up to {money(p.maxAmount)}</Badge>
                  ) : (
                    <Badge tone="danger">Does not qualify</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
          {query.data.products[0] && <CheckList checks={commonChecks(query.data.products[0])} />}
          {canApply &&
            customer.status === 'active' &&
            query.data.facts.openLoan?.status === 'active' &&
            query.data.facts.openLoan.kind === 'cash' && (
              <p className="text-sm">
                <Link
                  to={`/loans/new?customer=${customer.id}&topUp=${query.data.facts.openLoan.id}`}
                  className="font-medium underline"
                >
                  Check a top-up of {query.data.facts.openLoan.loanNumber}
                </Link>
              </p>
            )}
        </div>
      )}
    </Panel>
  )
}

/** On a loan: what the check found when the application was made. */
export function EligibilitySnapshotPanel({ snapshot }: { snapshot: LoanEligibilitySnapshot }) {
  return (
    <Panel title="Eligibility when applied">
      <div className="flex flex-col gap-2 text-sm">
        <p>
          {snapshot.qualified ? (
            <Badge tone="success">Within the lending policy</Badge>
          ) : (
            <Badge tone="warning">Outside the lending policy</Badge>
          )}
        </p>
        {snapshot.maxAmount > 0 && (
          <p className="text-ink-2">Qualified for up to {money(snapshot.maxAmount)}.</p>
        )}
        {snapshot.failed.length > 0 && (
          <ul className="text-brick list-disc pl-5">
            {snapshot.failed.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
        {!snapshot.qualified && !snapshot.enforced && (
          <p className="text-ink-2">
            The business flags these applications for the approver rather than refusing them.
          </p>
        )}
      </div>
    </Panel>
  )
}
