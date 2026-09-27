import { useEffect, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LICENCE_REQUIRED_EVENT } from '@/api/client'
import { systemApi, systemKeys } from '@/api/system'
import { ErrorState } from '@/components/states'
import { Logo } from '@/components/ui/Logo'
import { Spinner } from '@/components/ui/Spinner'
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
  if (status.isError)
    return (
      <div className="bg-paper flex min-h-dvh items-center justify-center p-4">
        <ErrorState error={status.error} onRetry={() => void status.refetch()} />
      </div>
    )
  if (status.data.licence?.status !== 'valid') return <LicenceScreen status={status.data} />
  if (!status.data.onboarded) return <OnboardingScreen status={status.data} />
  return <>{children}</>
}
