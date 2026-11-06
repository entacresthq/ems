import { Link } from 'react-router-dom'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { useSystemStatus } from '@/features/setup/useSystemStatus'
import { formatDate, todayIso } from '@/lib/dates'
import { hasPermission } from '@/lib/permissions'

/** Days before EMS locks when the warning starts. */
const WARN_DAYS = 10

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/**
 * Hosted EMS: warns the people who can pay that EMS will lock soon. Everyone else carries on
 * undisturbed; they only find out if it does lock.
 */
export function SubscriptionBanner() {
  const status = useSystemStatus()
  const user = useCurrentUser()
  // EMS on SynchGate: the subscription's state comes with the signed-in user.
  const business = user.business
  if (business && hasPermission(user, 'settings.manage')) {
    if (business.status !== 'past_due' && business.status !== 'expired') return null
    return (
      <p
        role="note"
        className="bg-ochre-tint border-ochre text-ink border-b px-4 py-1.5 text-center text-sm print:hidden"
      >
        <strong className="font-semibold">
          {business.status === 'expired'
            ? 'Your EMS subscription has ended.'
            : 'Your paid time has ended. EMS keeps working for a few more days.'}
        </strong>{' '}
        Renew to keep using every page.{' '}
        <Link to="/subscription" className="font-medium underline underline-offset-2">
          Renew now
        </Link>
      </p>
    )
  }
  const expires = status?.licence?.expires
  if (!status?.subscription || !expires || !hasPermission(user, 'settings.manage')) return null
  const left = daysBetween(todayIso(), expires)
  if (left > WARN_DAYS || left < 0) return null
  return (
    <p
      role="note"
      className="bg-ochre-tint border-ochre text-ink border-b px-4 py-1.5 text-center text-sm print:hidden"
    >
      {left === 0 ? (
        <strong className="font-semibold">EMS locks after today.</strong>
      ) : (
        <>
          <strong className="font-semibold">EMS locks after {formatDate(expires)}</strong> (
          {left === 1 ? '1 day' : `${left} days`}).
        </>
      )}{' '}
      Renew the subscription to keep working.{' '}
      <Link to="/subscription" className="font-medium underline underline-offset-2">
        Renew now
      </Link>
    </p>
  )
}
