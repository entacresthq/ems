import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { branchesApi, branchKeys } from '@/api/branches'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { hasPermission } from '@/lib/permissions'
import type { Branch, Id } from '@/types'

interface BranchScopeValue {
  /** Selected branch, or null for "All branches". */
  branchId: Id | null
  setBranchId: (id: Id | null) => void
  /** Whether this user may look across branches. */
  canSwitch: boolean
  branches: Branch[]
}

const BranchScopeContext = createContext<BranchScopeValue | null>(null)
const KEY = 'ems:branch-scope'

/**
 * The branch every back-office screen is filtered by. Head-office users can
 * switch between branches; everyone else is fixed to their own branch.
 */
export function BranchScopeProvider({ children }: { children: ReactNode }) {
  const user = useCurrentUser()
  const canSwitch = hasPermission(user, 'branches.all')
  const [selected, setSelected] = useState<Id | null>(() => {
    if (!canSwitch) return user.branchId
    try {
      return sessionStorage.getItem(KEY) || null
    } catch {
      return null
    }
  })

  // Branch-level staff get just their own branch back, which screens use for its areas.
  const { data } = useQuery({
    queryKey: branchKeys.list(),
    queryFn: () => branchesApi.list(),
    staleTime: 10 * 60_000,
  })
  // Operational branches only: headquarters has no customers to filter by.
  const branches = useMemo(() => (data?.results ?? []).filter((b) => b.kind === 'branch'), [data])

  // Ignore a remembered branch that no longer exists.
  const validSelected =
    selected && data && !branches.some((b) => b.id === selected) ? null : selected

  const value = useMemo<BranchScopeValue>(
    () => ({
      branchId: canSwitch ? validSelected : user.branchId,
      canSwitch,
      branches,
      setBranchId: (id) => {
        if (!canSwitch) return
        setSelected(id)
        try {
          if (id) sessionStorage.setItem(KEY, id)
          else sessionStorage.removeItem(KEY)
        } catch {
          // ignore
        }
      },
    }),
    [canSwitch, validSelected, user.branchId, branches],
  )

  return <BranchScopeContext.Provider value={value}>{children}</BranchScopeContext.Provider>
}

export function useBranchScope() {
  const ctx = useContext(BranchScopeContext)
  if (!ctx) throw new Error('useBranchScope must be used inside BranchScopeProvider')
  return ctx
}
