import type { Id, IsoDate, IsoDateTime, ListParams } from './common'

export type CustomerStatus = 'pending_approval' | 'active' | 'inactive' | 'blacklisted'
export type Gender = 'female' | 'male'

export interface NextOfKin {
  fullName: string
  relationship: string
  phone: string
  address: string
}

export interface Guarantor {
  fullName: string
  phone: string
  address: string
  relationship: string
  occupation: string
  bvn: string | null
}

export interface Customer {
  id: Id
  customerNumber: string
  firstName: string
  lastName: string
  otherNames: string
  gender: Gender
  dateOfBirth: IsoDate | null
  phone: string
  altPhone: string | null
  email: string | null
  bvn: string | null
  address: string
  /** Collection area / route used to group the officer's day. */
  area: string
  occupation: string
  branchId: Id
  branchName: string
  officerId: Id
  officerName: string
  status: CustomerStatus
  photoUrl: string | null
  signatureUrl: string | null
  nextOfKin: NextOfKin | null
  guarantors: Guarantor[]
  createdAt: IsoDateTime
}

export interface CustomerListParams extends ListParams {
  branch?: Id
  officer?: Id
  status?: CustomerStatus
  area?: string
}

/** Body for creating or editing a customer. */
export interface CustomerInput {
  firstName: string
  lastName: string
  otherNames: string
  gender: Gender
  dateOfBirth: IsoDate | null
  phone: string
  altPhone: string | null
  email: string | null
  bvn: string | null
  address: string
  area: string
  occupation: string
  branchId: Id
  officerId: Id
  nextOfKin: NextOfKin | null
  guarantors: Guarantor[]
  /** Field registrations: the thrift plan to open once approved. */
  thriftPlanId?: Id | null
}
