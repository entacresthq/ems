import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { isApiError } from '@/api/client'
import {
  subscriptionApi,
  subscriptionKeys,
  type Payment,
  type SubscriptionState,
  type Tenant,
} from '@/api/subscription'
import { Select } from '@/components/form/inputs'
import { ErrorState, LoadingState } from '@/components/states'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { DescriptionList, Money, Panel } from '@/components/ui/display'
import { PageHeader } from '@/components/ui/PageHeader'
import { Badge, type Tone } from '@/components/ui/StatusBadge'
import { formatDate } from '@/lib/dates'
import { formatNaira, kobo } from '@/lib/money'
import { PlanPicker } from './PlanPicker'

const STATE: Record<SubscriptionState, { label: string; tone: Tone }> = {
  trial: { label: 'Free trial', tone: 'info' },
  active: { label: 'Active', tone: 'success' },
  past_due: { label: 'Payment due', tone: 'warning' },
  expired: { label: 'Ended', tone: 'danger' },
  suspended: { label: 'Suspended', tone: 'danger' },
}

const PAYMENT: Record<Payment['status'], { label: string; tone: Tone }> = {
  paid: { label: 'Paid', tone: 'success' },
  pending: { label: 'Not completed', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'danger' },
}

/** Hosted EMS: the plan, how long it runs, and paying for more. MD and settings managers. */
export function SubscriptionPage() {
  const summary = useQuery({ queryKey: subscriptionKeys.summary, queryFn: subscriptionApi.summary })

  if (summary.isPending) return <LoadingState />
  if (summary.isError)
    return <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />

  const { tenant, plans, monthOptions, payments } = summary.data
  return (
    <>
      <PageHeader
        title="Subscription"
        description="Your EMS plan and payments. Pay ahead and the new time starts when the current time ends."
      />
      <div className="flex flex-col gap-6">
        <StatusPanel tenant={tenant} />
        <Panel title="Pay for EMS">
          <Checkout
            key={tenant.plan.code}
            tenant={tenant}
            plans={plans}
            monthOptions={monthOptions}
          />
        </Panel>
        <Panel title="Payments" flush>
          <PaymentList payments={payments} />
        </Panel>
      </div>
    </>
  )
}

function StatusPanel({ tenant }: { tenant: Tenant }) {
  const state = STATE[tenant.status]
  const runsTo = tenant.paidThrough ?? tenant.trialEndsAt
  return (
    <Panel title="Your plan" actions={<Badge tone={state.tone}>{state.label}</Badge>}>
      {tenant.status === 'past_due' && tenant.licenceExpires && (
        <Alert tone="warning" className="mb-4">
          Your paid time has ended. EMS keeps working until{' '}
          <strong>{formatDate(tenant.licenceExpires)}</strong>, then locks until it is renewed. Your
          data is kept.
        </Alert>
      )}
      <DescriptionList
        columns={3}
        items={[
          { label: 'Plan', value: tenant.plan.name },
          {
            label: 'Branches',
            value:
              tenant.plan.maxBranches === null ? 'Unlimited' : `Up to ${tenant.plan.maxBranches}`,
          },
          { label: 'Price', value: `${formatNaira(tenant.plan.monthlyPrice)} a month` },
          {
            label: tenant.paidThrough ? 'Paid up to' : 'Free trial ends',
            value: runsTo ? formatDate(runsTo) : null,
          },
          {
            label: 'EMS locks after',
            value: tenant.licenceExpires ? formatDate(tenant.licenceExpires) : null,
          },
          { label: 'Address', value: tenant.address },
        ]}
      />
    </Panel>
  )
}

function Checkout({
  tenant,
  plans,
  monthOptions,
}: {
  tenant: Tenant
  plans: Tenant['plan'][]
  monthOptions: number[]
}) {
  const offered = plans.some((p) => p.code === tenant.plan.code) ? plans : [tenant.plan, ...plans]
  const [plan, setPlan] = useState(tenant.plan.code)
  const [months, setMonths] = useState(monthOptions[0] ?? 1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chosen = offered.find((p) => p.code === plan) ?? tenant.plan
  const total = kobo(chosen.monthlyPrice * months)
  const switching = plan !== tenant.plan.code && Boolean(tenant.paidThrough)

  const pay = async () => {
    setBusy(true)
    setError(null)
    try {
      const { paymentUrl } = await subscriptionApi.checkout({ plan, months })
      window.location.assign(paymentUrl)
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Payment couldn’t start. Try again.')
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PlanPicker plans={offered} value={plan} onChange={setPlan} current={tenant.plan.code} />
      {switching && (
        <Alert tone="info">
          Moving to {chosen.name} starts now. The paid time you have left on {tenant.plan.name} is
          turned into time on {chosen.name} at its price, so nothing you paid is lost.
        </Alert>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <Select
          label="Pay for"
          value={months}
          onChange={(e) => setMonths(Number(e.target.value))}
          containerClassName="sm:w-48"
        >
          {monthOptions.map((m) => (
            <option key={m} value={m}>
              {m === 1 ? '1 month' : `${m} months`}
            </option>
          ))}
        </Select>
        <Button variant="primary" loading={busy} onClick={() => void pay()}>
          Pay <Money value={total} />
        </Button>
      </div>
      <p className="text-ink-2 text-sm">
        You’ll pay securely with Paystack by card, bank transfer or USSD, then come back here.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  )
}

function PaymentList({ payments }: { payments: Payment[] }) {
  if (!payments.length) return <p className="text-ink-2 px-4 py-6 text-sm">No payments yet.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-ink-2 text-left text-xs">
          <tr className="border-rule border-b">
            <th className="px-4 py-2 font-medium">Date</th>
            <th className="px-4 py-2 font-medium">Plan</th>
            <th className="px-4 py-2 font-medium">Covers</th>
            <th className="px-4 py-2 text-right font-medium">Amount</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Reference</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => {
            const state = PAYMENT[p.status]
            return (
              <tr key={p.reference} className="border-rule border-b last:border-0">
                <td className="px-4 py-2 whitespace-nowrap">
                  {formatDate(p.paidAt ?? p.createdAt)}
                </td>
                <td className="px-4 py-2">
                  {p.planName} · {p.months === 1 ? '1 month' : `${p.months} months`}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {p.periodStart && p.periodEnd
                    ? `${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}`
                    : '—'}
                </td>
                <td className="px-4 py-2 text-right">
                  <Money value={p.amount} />
                </td>
                <td className="px-4 py-2" title={p.failureReason || undefined}>
                  <Badge tone={state.tone}>{state.label}</Badge>
                </td>
                <td className="text-ink-2 px-4 py-2 font-mono text-xs">{p.reference}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
