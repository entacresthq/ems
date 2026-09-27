import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  CalendarCheck,
  CircleUserRound,
  CloudUpload,
  HandCoins,
  Search,
  Sunset,
  WifiOff,
} from 'lucide-react'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/features/auth/AuthProvider'
import { DemoBadge, DemoBanner } from '@/features/setup/DemoBanner'
import { FieldDataProvider, useFieldData } from '@/features/field/FieldData'
import { FieldLockGate } from '@/features/field/FieldLock'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { cn } from '@/lib/cn'

const TABS = [
  { to: '/field/today', label: 'Today', icon: CalendarCheck },
  { to: '/field/collect', label: 'Collect', icon: HandCoins },
  { to: '/field/customers', label: 'Customers', icon: Search },
  { to: '/field/end-of-day', label: 'End of day', icon: Sunset },
  { to: '/field/me', label: 'Me', icon: CircleUserRound },
] as const

export function FieldShell() {
  return (
    <FieldLockGate>
      <FieldDataProvider>
        <FieldFrame />
      </FieldDataProvider>
    </FieldLockGate>
  )
}

function FieldFrame() {
  const { pathname } = useLocation()
  const title = TABS.find((t) => pathname.startsWith(t.to))?.label ?? 'EMS Field'

  return (
    <div className="text-field flex min-h-dvh flex-col bg-white">
      <DemoBanner />
      <header className="on-dark bg-ink sticky top-0 z-20 text-white">
        <div className="mx-auto flex h-14 max-w-xl items-center justify-between px-4">
          <p className="flex items-center gap-2 text-lg font-semibold">
            {title}
            <DemoBadge onDark />
          </p>
          <ConnectionPill />
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-xl flex-1 px-4 pt-4 pb-28">
        <Outlet />
      </main>

      <nav
        aria-label="Field app"
        className="safe-bottom border-rule-strong fixed inset-x-0 bottom-0 z-20 border-t bg-white"
      >
        <ul className="mx-auto grid h-16 max-w-xl grid-cols-5">
          {TABS.map((tab) => (
            <li key={tab.to}>
              <NavLink
                to={tab.to}
                className={({ isActive }) =>
                  cn(
                    'flex h-full flex-col items-center justify-center gap-0.5 text-xs font-medium',
                    isActive ? 'text-ink shadow-[inset_0_3px_0_var(--color-ink)]' : 'text-ink-3',
                  )
                }
              >
                <tab.icon className="size-6" aria-hidden />
                {tab.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}

/** Network and sync status. Tap to send waiting collections now. */
function ConnectionPill() {
  const online = useOnlineStatus()
  const { state } = useAuth()
  const { unsyncedCount, failedCount, sync, syncing } = useFieldData()
  const serverReachable = online && !(state.status === 'authenticated' && state.offline)
  const base =
    'inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold'

  if (!serverReachable) {
    return (
      <span role="status" className={cn(base, 'bg-ochre-tint text-ochre')}>
        <WifiOff className="size-3.5" aria-hidden />
        Offline{unsyncedCount > 0 && ` · ${unsyncedCount} saved`}
      </span>
    )
  }
  if (unsyncedCount > 0) {
    return (
      <button
        type="button"
        onClick={() => void sync()}
        className={cn(base, 'bg-ochre-tint text-ochre')}
      >
        {syncing ? (
          <Spinner className="size-3.5" />
        ) : (
          <CloudUpload className="size-3.5" aria-hidden />
        )}
        {unsyncedCount} to sync
      </button>
    )
  }
  return (
    <span
      role="status"
      className={cn(
        base,
        failedCount > 0 ? 'bg-brick-tint text-brick-strong' : 'bg-white/10 text-white',
      )}
    >
      <span
        className={cn('size-2 rounded-full', failedCount > 0 ? 'bg-brick' : 'bg-ledger-bright')}
        aria-hidden
      />
      {failedCount > 0 ? `${failedCount} need attention` : 'All synced'}
    </span>
  )
}
