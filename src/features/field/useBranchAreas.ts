import { useQuery } from '@tanstack/react-query'
import { branchesApi, branchKeys } from '@/api/branches'
import { useCurrentUser } from '@/features/auth/AuthProvider'

/** Collection areas of the officer's branch. */
export function useBranchAreas(): string[] {
  const user = useCurrentUser()
  const query = useQuery({
    queryKey: branchKeys.list(),
    queryFn: () => branchesApi.list(),
    staleTime: 10 * 60_000,
  })
  return query.data?.results.find((b) => b.id === user.branchId)?.areas ?? []
}
