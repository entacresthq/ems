import { encodeCharges } from '@/lib/charges'
import { toDecimal } from '@/lib/money'
import type {
  AuditEntry,
  AuditListParams,
  Branch,
  BusinessSettings,
  Id,
  Paginated,
  SettingsInput,
  Staff,
} from '@/types'
import { api } from './client'
import type { Wire } from './decode'
import { decode } from './decoders'

export const adminKeys = {
  settings: ['settings'] as const,
  audit: (params: AuditListParams) => ['audit', params] as const,
  staffDetail: (id: Id) => ['staff', 'detail', id] as const,
}

export type StaffInput = Pick<
  Staff,
  'firstName' | 'lastName' | 'email' | 'phone' | 'role' | 'branchId' | 'permissions'
>
export type BranchInput = Pick<
  Branch,
  'name' | 'code' | 'address' | 'phone' | 'areas' | 'managerId' | 'status'
>
export interface StaffWithPassword {
  staff: Staff & { mustChangePassword: boolean }
  temporaryPassword: string
}

export const settingsApi = {
  async get(): Promise<BusinessSettings> {
    return decode.settings(await api.get<Wire<BusinessSettings>>('/settings/'))
  },
  async update(input: SettingsInput): Promise<BusinessSettings> {
    const body = {
      ...input,
      largeWithdrawalThreshold:
        input.largeWithdrawalThreshold === undefined
          ? undefined
          : toDecimal(input.largeWithdrawalThreshold),
      transactionCharges:
        input.transactionCharges === undefined
          ? undefined
          : encodeCharges(input.transactionCharges),
    }
    return decode.settings(await api.patch<Wire<BusinessSettings>>('/settings/', body))
  },
}

export const auditApi = {
  list: (params: AuditListParams) =>
    api.get<Paginated<AuditEntry>>('/audit/', { query: { ...params } }),
}

export const branchAdminApi = {
  create: (input: BranchInput) => api.post<Branch>('/branches/', input),
  update: (id: Id, input: Partial<BranchInput>) => api.patch<Branch>(`/branches/${id}/`, input),
}

export const staffAdminApi = {
  get: (id: Id) => api.get<Staff & { mustChangePassword: boolean }>(`/staff/${id}/`),
  create: (input: StaffInput) => api.post<StaffWithPassword>('/staff/', input),
  update: (id: Id, input: Partial<StaffInput>) => api.patch<Staff>(`/staff/${id}/`, input),
  suspend: (id: Id, reason: string) => api.post<Staff>(`/staff/${id}/suspend/`, { reason }),
  deactivate: (id: Id, reason: string) => api.post<Staff>(`/staff/${id}/deactivate/`, { reason }),
  reactivate: (id: Id) => api.post<Staff>(`/staff/${id}/reactivate/`, {}),
  resetPassword: (id: Id) => api.post<StaffWithPassword>(`/staff/${id}/reset-password/`, {}),
  reassignCustomers: (customerIds: Id[], officerId: Id) =>
    api.post<{ moved: number }>('/customers/reassign/', { customerIds, officerId }),
}
