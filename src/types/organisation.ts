import type { Permission, Role, StaffStatus } from './auth'
import type { Id, IsoDateTime, ListParams } from './common'

export type BranchKind = 'headquarters' | 'branch'

export interface Branch {
  id: Id
  /** Headquarters oversees every branch and holds no customers. */
  kind: BranchKind
  code: string
  name: string
  address: string
  phone: string
  /** Collection areas officers are grouped by. */
  areas: string[]
  managerId: Id | null
  managerName: string | null
  status: 'active' | 'inactive'
  staffCount: number
  customerCount: number
  createdAt: IsoDateTime
}

export interface Staff {
  id: Id
  staffId: string
  firstName: string
  lastName: string
  email: string
  phone: string
  role: Role
  branchId: Id | null
  branchName: string | null
  status: StaffStatus
  /** What this person may do: chosen from what their role allows when they are added. */
  permissions: Permission[]
  lastLoginAt: IsoDateTime | null
  createdAt: IsoDateTime
}

export interface StaffListParams extends ListParams {
  branch?: Id
  role?: Role
  status?: StaffStatus
}

/** Minimal officer record for pickers; visible to any back-office role. */
export interface OfficerOption {
  id: Id
  name: string
  branchId: Id
  branchName: string
  status: StaffStatus
}
