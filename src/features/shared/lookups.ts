import { useQuery } from '@tanstack/react-query'
import { officerKeys, officersApi } from '@/api/officers'
import { thriftPlanKeys, thriftPlansApi } from '@/api/thriftPlans'
import type { Id, ThriftPlan } from '@/types'

/** Officers for pickers, limited to a branch when one is chosen. */
export function useOfficers(branchId: Id | null, enabled = true) {
  return useQuery({
    queryKey: officerKeys.list(branchId),
    queryFn: () => officersApi.list(branchId),
    select: (page) => page.results,
    staleTime: 5 * 60_000,
    enabled,
  })
}

export function useThriftPlans(status?: ThriftPlan['status']) {
  return useQuery({
    queryKey: thriftPlanKeys.list(status),
    queryFn: () => thriftPlansApi.list(status),
    select: (page) => page.results,
    staleTime: 5 * 60_000,
  })
}
