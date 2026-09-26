import type { Id, Paginated, Staff, StaffListParams } from '@/types'
import { api } from './client'

export const staffKeys = {
  all: ['staff'] as const,
  list: (params: StaffListParams = {}) => [...staffKeys.all, 'list', params] as const,
  detail: (id: Id) => [...staffKeys.all, 'detail', id] as const,
}

export const staffApi = {
  list: (params: StaffListParams = {}) =>
    api.get<Paginated<Staff>>('/staff/', { query: { ...params } }),
  get: (id: Id) => api.get<Staff>(`/staff/${id}/`),
}
