import type { Id, OfficerOption, Paginated } from '@/types'
import { api } from './client'

export const officerKeys = {
  list: (branch: Id | null) => ['officers', branch ?? 'all'] as const,
}

export const officersApi = {
  list: (branch: Id | null) =>
    api.get<Paginated<OfficerOption>>('/officers/', { query: { pageSize: 100, branch } }),
}
