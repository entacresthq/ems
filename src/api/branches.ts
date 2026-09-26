import type { Branch, Id, ListParams, Paginated } from '@/types'
import { api } from './client'

export const branchKeys = {
  all: ['branches'] as const,
  list: (params: ListParams = {}) => [...branchKeys.all, 'list', params] as const,
  detail: (id: Id) => [...branchKeys.all, 'detail', id] as const,
}

export const branchesApi = {
  list: (params: ListParams = {}) =>
    api.get<Paginated<Branch>>('/branches/', { query: { pageSize: 100, ...params } }),
  get: (id: Id) => api.get<Branch>(`/branches/${id}/`),
}
