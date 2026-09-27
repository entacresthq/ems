import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { approvalKeys, approvalsApi } from '@/api/operations'
import { ChevronDown, KeyRound, LogOut, Menu as MenuIcon, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Logo } from '@/components/ui/Logo'
import { Menu } from '@/components/ui/Menu'
import { config } from '@/config'
import { useAuth, useCurrentUser } from '@/features/auth/AuthProvider'
import { useIdleTimeout } from '@/features/auth/useIdleTimeout'
import { BranchScopeProvider, useBranchScope } from '@/features/organisation/BranchScope'
import { cn } from '@/lib/cn'
import { hasPermission } from '@/lib/permissions'
import { ROLE_LABELS } from '@/types'
import { BACK_OFFICE_NAV, DESIGN_SYSTEM_ITEM } from './navigation'
import { DemoBadge, DemoBanner } from '@/features/setup/DemoBanner'

export function BackOfficeShell() {
  return (
    <BranchScopeProvider>
      <ShellFrame />
    </BranchScopeProvider>
  )
}

function ShellFrame() {
  const location = useLocation()
  const { logout } = useAuth()
  const [drawerPath, setDrawerPath] = useState<string | null>(null)
  const drawerOpen = drawerPath === location.pathname
  const setDrawerOpen = (open: boolean) => setDrawerPath(open ? location.pathname : null)

  const idle = useIdleTimeout({
    timeoutMs: config.backOfficeIdleMs,
    warningMs: config.idleWarningMs,
    onTimeout: () =>
      void logout(
        'You were signed out after 15 minutes without activity. Sign in again to continue.',
      ),
  })

  return (
    <div className="bg-paper min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] print:block print:bg-white">
      <a
        href="#main"
        className="bg-surface sr-only z-50 px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar */}
      <aside className="on-dark bg-ink sticky top-0 hidden h-dvh flex-col text-white lg:flex print:hidden">
        <Sidebar />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="bg-ink/45 absolute inset-0"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="on-dark bg-ink relative flex h-full w-72 max-w-[85vw] flex-col text-white">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="absolute top-3 right-3 rounded p-2 text-white/80 hover:bg-white/10"
              aria-label="Close menu"
            >
              <X className="size-5" aria-hidden />
            </button>
            <Sidebar />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <DemoBanner />
        <TopBar onOpenMenu={() => setDrawerOpen(true)} />
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:px-8"
        >
          <Outlet />
        </main>
      </div>

      <Dialog
        open={idle.warning}
        onClose={idle.stayActive}
        title="Are you still there?"
        description={`For security, you'll be signed out in ${idle.secondsLeft} seconds because there's been no activity.`}
        size="sm"
        footer={
          <>
            <Button onClick={() => void logout()}>Sign out now</Button>
            <Button variant="primary" onClick={idle.stayActive}>
              Stay signed in
            </Button>
          </>
        }
      />
    </div>
  )
}

function Sidebar() {
  const user = useCurrentUser()
  const groups = BACK_OFFICE_NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => hasPermission(user, i.permission)),
  })).filter((g) => g.items.length > 0)
  const showDesignSystem = import.meta.env.DEV || config.useMocks
  const { branchId } = useBranchScope()
  const pending = useQuery({
    queryKey: approvalKeys.pendingCount(branchId),
    queryFn: () => approvalsApi.pendingCount(branchId),
    enabled: hasPermission(user, 'approvals.decide'),
    refetchInterval: 60_000,
  })

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex items-center gap-3 rounded px-3 py-2 text-sm',
      isActive
        ? 'bg-white/10 font-semibold text-white shadow-[inset_3px_0_0_var(--color-ledger-bright)]'
        : 'text-white/75 hover:bg-white/5 hover:text-white',
    )

  return (
    <>
      <div className="flex h-14 shrink-0 items-center px-5">
        <Logo onDark />
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-6">
        {groups.map((group, i) => (
          <div key={group.label ?? i} className="mt-4 first:mt-2">
            {group.label && (
              <p className="px-3 pb-1 text-xs font-medium text-white/55">{group.label}</p>
            )}
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} end={item.to === '/'} className={linkClass}>
                    <item.icon className="size-4 shrink-0" aria-hidden />
                    {item.label}
                    {item.to === '/approvals' && pending.data ? (
                      <span className="bg-ochre-tint text-ochre tabular ml-auto rounded-sm px-1.5 text-xs font-semibold">
                        {pending.data}
                        <span className="sr-only"> waiting</span>
                      </span>
                    ) : null}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {showDesignSystem && (
          <div className="mt-6 border-t border-white/10 pt-4">
            <NavLink to={DESIGN_SYSTEM_ITEM.to} className={linkClass}>
              <DESIGN_SYSTEM_ITEM.icon className="size-4 shrink-0" aria-hidden />
              {DESIGN_SYSTEM_ITEM.label}
            </NavLink>
          </div>
        )}
      </nav>
      <p className="shrink-0 border-t border-white/10 px-5 py-3 text-xs text-white/55">
        An Entacrest Nexus product
      </p>
    </>
  )
}

function TopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const user = useCurrentUser()
  const { logout } = useAuth()
  const scope = useBranchScope()
  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`

  return (
    <header className="border-rule bg-surface sticky top-0 z-20 flex h-14 items-center gap-3 border-b px-4 sm:px-6 lg:px-8 print:hidden">
      <button
        type="button"
        onClick={onOpenMenu}
        className="hover:bg-ink-tint -ml-2 rounded p-2 lg:hidden"
        aria-label="Open menu"
      >
        <MenuIcon className="size-5" aria-hidden />
      </button>

      <DemoBadge />
      {scope.canSwitch ? (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-2 hidden sm:inline">Branch</span>
          <span className="relative">
            <select
              value={scope.branchId ?? ''}
              onChange={(e) => scope.setBranchId(e.target.value || null)}
              className="border-rule-strong bg-surface h-9 appearance-none rounded border pr-8 pl-3 text-sm font-medium"
              aria-label="Branch shown on every screen"
            >
              <option value="">All branches</option>
              {scope.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <ChevronDown
              className="text-ink-2 pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2"
              aria-hidden
            />
          </span>
        </label>
      ) : (
        <p className="text-ink-2 text-sm">
          <span className="text-ink font-medium">{user.branchName}</span> branch
        </p>
      )}

      <div className="ml-auto">
        <Menu
          triggerLabel={`Account menu for ${user.firstName} ${user.lastName}`}
          trigger={
            <>
              <span
                className="bg-ink flex size-8 items-center justify-center rounded-full text-xs font-semibold text-white"
                aria-hidden
              >
                {initials}
              </span>
              <span className="hidden text-left sm:block">
                <span className="block text-sm leading-tight font-medium">
                  {user.firstName} {user.lastName}
                </span>
                <span className="text-ink-2 block text-xs leading-tight">
                  {ROLE_LABELS[user.role]}
                </span>
              </span>
              <ChevronDown className="text-ink-2 size-4" aria-hidden />
            </>
          }
          items={[
            {
              type: 'link',
              label: 'Change password',
              to: '/change-password',
              icon: <KeyRound className="size-4" aria-hidden />,
            },
            { type: 'separator' },
            {
              type: 'button',
              label: 'Sign out',
              onSelect: () => void logout(),
              icon: <LogOut className="size-4" aria-hidden />,
            },
          ]}
        />
      </div>
    </header>
  )
}
