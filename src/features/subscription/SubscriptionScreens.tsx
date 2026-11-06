import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { isApiError } from '@/api/client'
import { subscriptionApi, subscriptionKeys, type Payment } from '@/api/subscription'
import { systemApi, systemKeys, type SystemStatus } from '@/api/system'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Money } from '@/components/ui/display'
import { Spinner } from '@/components/ui/Spinner'
import { formatDate } from '@/lib/dates'
import { SetupLayout } from '@/features/setup/SetupLayout'

/**
 * Hosted EMS, shown by SetupGate whoever is (or isn't) signed in:
 * the lock screen once the subscription ends, and the page Paystack returns to.
 */

/** Replaces the licence-code screen: hosted businesses renew by paying. */
export function SubscriptionEndedScreen({ status }: { status: SystemStatus }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const licence = status.licence

  const renew = async () => {
    setBusy(true)
    setError(null)
    try {
      window.location.assign((await systemApi.renew()).paymentUrl)
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Payment couldn’t start. Try again.')
      setBusy(false)
    }
  }

  return (
    <SetupLayout
      step={0}
      title="Your EMS subscription has ended"
      description={
        <>
          {status.businessName ?? licence?.licensee ?? 'This business'} can’t use EMS until the
          subscription is renewed.
          {licence?.expires && <> It ended on {formatDate(licence.expires)}.</>} Your data is kept
          safe.
        </>
      }
      aside={
        <div className="text-sm">
          <h2 className="font-semibold">Want another plan?</h2>
          <p className="text-ink-2 mt-1">
            Renew for a month to get back in, then change your plan under Administration →
            Subscription.
          </p>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          Renewing pays for one month of your current plan
          {licence?.plan ? (
            <>
              {' '}
              (<span className="capitalize">{licence.plan}</span>)
            </>
          ) : null}{' '}
          with Paystack. EMS opens again as soon as the payment goes through.
        </p>
        {error && <Alert tone="danger">{error}</Alert>}
        <div>
          <Button variant="primary" size="lg" loading={busy} onClick={() => void renew()}>
            Renew subscription
          </Button>
        </div>
      </div>
    </SetupLayout>
  )
}

/** Paystack sends the payer back to /subscription/return?reference=…; confirm it here. */
export function PaymentReturnScreen() {
  const queryClient = useQueryClient()
  const reference =
    new URLSearchParams(window.location.search).get('reference') ??
    new URLSearchParams(window.location.search).get('trxref') ??
    ''
  const [state, setState] = useState<
    | { kind: 'checking' }
    | { kind: 'done'; payment: Payment; status: SystemStatus }
    | { kind: 'error'; message: string }
  >(
    reference
      ? { kind: 'checking' }
      : { kind: 'error', message: 'The payment reference is missing.' },
  )
  const started = useRef(false)

  useEffect(() => {
    if (!reference || started.current) return
    started.current = true
    systemApi.verifyPayment(reference).then(
      (result) => setState({ kind: 'done', ...result }),
      (err: unknown) =>
        setState({
          kind: 'error',
          message: isApiError(err) ? err.message : 'EMS couldn’t check the payment. Try again.',
        }),
    )
  }, [reference])

  const carryOn = (status: SystemStatus | null) => {
    if (status) queryClient.setQueryData(systemKeys.status, status)
    // Back to EMS; a signed-in manager lands on the subscription page.
    window.location.replace(status?.licence?.status === 'valid' ? '/subscription' : '/')
  }

  if (state.kind === 'checking')
    return (
      <SetupLayout step={2} title="Checking your payment">
        <p className="text-ink-2 flex items-center gap-2 text-sm" role="status">
          <Spinner /> Confirming with Paystack…
        </p>
      </SetupLayout>
    )

  if (state.kind === 'error')
    return (
      <SetupLayout step={2} title="We couldn’t confirm the payment">
        <div className="flex flex-col gap-4">
          <Alert tone="danger">{state.message}</Alert>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => window.location.reload()}>
              Try again
            </Button>
            <Button onClick={() => carryOn(null)}>Back to EMS</Button>
          </div>
        </div>
      </SetupLayout>
    )

  const { payment, status } = state
  const title =
    payment.status === 'paid'
      ? 'Payment received'
      : payment.status === 'failed'
        ? 'The payment didn’t go through'
        : 'Payment not confirmed yet'
  return (
    <SetupLayout step={2} title={title}>
      <div className="flex flex-col gap-4 text-sm">
        {payment.status === 'paid' && (
          <Alert tone="success">
            <Money value={payment.amount} /> for{' '}
            {payment.months === 1 ? '1 month' : `${payment.months} months`} of {payment.planName}.
            {payment.periodEnd && <> EMS is paid up to {formatDate(payment.periodEnd)}.</>} A
            receipt is on its way from Paystack.
          </Alert>
        )}
        {payment.status === 'failed' && (
          <Alert tone="danger">
            {payment.failureReason || 'The payment failed.'} Nothing was charged for EMS. Try again,
            or use another card or bank.
          </Alert>
        )}
        {payment.status === 'pending' && (
          <Alert tone="warning">
            Paystack hasn’t confirmed this payment yet. If you paid by bank transfer it can take a
            few minutes. EMS updates by itself once it’s confirmed.
          </Alert>
        )}
        <p className="text-ink-2 font-mono text-xs">Reference {payment.reference}</p>
        <div>
          <Button variant="primary" size="lg" onClick={() => carryOn(status)}>
            Continue to EMS
          </Button>
        </div>
      </div>
    </SetupLayout>
  )
}

/**
 * Paystack sends the payer back to /subscription/return?reference=…, signed in. Confirms the
 * payment with the API, then back to the subscription page.
 */
export function PaymentReturnPage() {
  const queryClient = useQueryClient()
  const params = new URLSearchParams(window.location.search)
  const reference = params.get('reference') ?? params.get('trxref') ?? ''
  const [state, setState] = useState<
    { kind: 'checking' } | { kind: 'done'; payment: Payment } | { kind: 'error'; message: string }
  >(
    reference
      ? { kind: 'checking' }
      : { kind: 'error', message: 'The payment reference is missing.' },
  )
  const started = useRef(false)

  useEffect(() => {
    if (!reference || started.current) return
    started.current = true
    subscriptionApi.verify(reference).then(
      (payment) => {
        void queryClient.invalidateQueries({ queryKey: subscriptionKeys.summary })
        setState({ kind: 'done', payment })
      },
      (err: unknown) =>
        setState({
          kind: 'error',
          message: isApiError(err) ? err.message : 'EMS couldn’t check the payment. Try again.',
        }),
    )
  }, [reference, queryClient])

  const back = () => window.location.replace('/subscription')

  if (state.kind === 'checking')
    return (
      <SetupLayout step={2} title="Checking your payment">
        <p className="text-ink-2 flex items-center gap-2 text-sm" role="status">
          <Spinner /> Confirming with Paystack…
        </p>
      </SetupLayout>
    )
  if (state.kind === 'error')
    return (
      <SetupLayout step={2} title="We couldn’t confirm the payment">
        <div className="flex flex-col gap-4">
          <Alert tone="danger">{state.message}</Alert>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => window.location.reload()}>
              Try again
            </Button>
            <Button onClick={back}>Back to EMS</Button>
          </div>
        </div>
      </SetupLayout>
    )
  const { payment } = state
  return (
    <SetupLayout
      step={2}
      title={
        payment.status === 'paid'
          ? 'Payment received'
          : payment.status === 'failed'
            ? 'The payment didn’t go through'
            : 'Payment not confirmed yet'
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        {payment.status === 'paid' && (
          <Alert tone="success">
            <Money value={payment.amount} /> for{' '}
            {payment.months === 1 ? '1 month' : `${payment.months} months`} of {payment.planName}.
            {payment.periodEnd && <> EMS is paid up to {formatDate(payment.periodEnd)}.</>}
          </Alert>
        )}
        {payment.status === 'failed' && (
          <Alert tone="danger">
            {payment.failureReason || 'The payment failed.'} Try again, or use another card or bank.
          </Alert>
        )}
        {payment.status === 'pending' && (
          <Alert tone="warning">
            Paystack hasn’t confirmed this payment yet. If you paid by bank transfer it can take a
            few minutes.
          </Alert>
        )}
        <p className="text-ink-2 font-mono text-xs">Reference {payment.reference}</p>
        <div>
          <Button variant="primary" size="lg" onClick={back}>
            Continue to EMS
          </Button>
        </div>
      </div>
    </SetupLayout>
  )
}
