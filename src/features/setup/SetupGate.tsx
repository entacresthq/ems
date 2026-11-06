import { useEffect, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isApiError, LICENCE_REQUIRED_EVENT } from '@/api/client'
import { systemApi, systemKeys } from '@/api/system'
import { ErrorState } from '@/components/states'
import { Logo } from '@/components/ui/Logo'
import { Spinner } from '@/components/ui/Spinner'
import { SignupScreen } from '@/features/subscription/SignupScreen'
import {
  PaymentReturnScreen,
  SubscriptionEndedScreen,
} from '@/features/subscription/SubscriptionScreens'
import { LicenceScreen } from './LicenceScreen'
import { OnboardingScreen } from './OnboardingScreen'

/**
 * An EMS server (desktop or web) stays locked until a licence is entered and the business is
 * set up. The server enforces this too; this just shows the right screen.
 */
export function SetupGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const status = useQuery({
    queryKey: systemKeys.status,
    queryFn: systemApi.status,
    staleTime: Infinity,
  })

  useEffect(() => {
    const recheck = () => void queryClient.invalidateQueries({ queryKey: systemKeys.status })
    window.addEventListener(LICENCE_REQUIRED_EVENT, recheck)
    return () => window.removeEventListener(LICENCE_REQUIRED_EVENT, recheck)
  }, [queryClient])

  if (status.isPending)
    return (
      <div
        className="bg-paper flex min-h-dvh flex-col items-center justify-center gap-4"
        role="status"
      >
        <Logo withProduct />
        <span className="text-ink-2 flex items-center gap-2 text-sm">
          <Spinner /> Starting EMS…
        </span>
      </div>
    )
  // Hosted EMS: the bare address is where new businesses sign up.
  if (status.isError && isApiError(status.error) && status.error.code === 'signup')
    return <SignupScreen />
  if (status.isError)
    return (
      <div className="bg-paper flex min-h-dvh items-center justify-center p-4">
        <ErrorState
          error={status.error}
          onRetry={() => void status.refetch()}
          title={unavailableTitle(status.error)}
        />
      </div>
    )
  // Hosted EMS: back from Paystack, signed in or not, and even while locked.
  if (status.data.subscription && window.location.pathname === '/subscription/return')
    return <PaymentReturnScreen />
  if (status.data.licence?.status !== 'valid')
    return status.data.subscription ? (
      <SubscriptionEndedScreen status={status.data} />
    ) : (
      <LicenceScreen status={status.data} />
    )
  if (!status.data.onboarded) return <OnboardingScreen status={status.data} />
  return <>{children}</>
}

/** On a server holding several businesses: no business at this address, or it is suspended. */
function unavailableTitle(error: unknown) {
  if (!isApiError(error)) return undefined
  if (error.code === 'unknown_business') return 'No EMS here'
  if (error.code === 'business_suspended') return 'EMS is suspended'
  return undefined
}
