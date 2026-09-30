import type { Id, IsoDateTime } from './common'

export const ROLES = [
  'md',
  'general_manager',
  'branch_manager',
  'accountant',
  'cashier',
  'account_officer',
  'admin',
] as const
export type Role = (typeof ROLES)[number]

/** Roles based at headquarters rather than a branch. */
export const HEADQUARTERS_ROLES: readonly Role[] = ['md', 'general_manager', 'admin']

/**
 * The MD and general managers approve everyone else's requests, so what they
 * start themselves (loans, reversals, large withdrawals, closures) needs no approval.
 */
export const SELF_APPROVING_ROLES: readonly Role[] = ['md', 'general_manager']
export const approvesOwnRequests = (staff: { role: Role }) =>
  SELF_APPROVING_ROLES.includes(staff.role)

export const ROLE_LABELS: Record<Role, string> = {
  md: 'Managing director',
  general_manager: 'General manager',
  branch_manager: 'Branch manager',
  accountant: 'Accountant',
  cashier: 'Cashier',
  account_officer: 'Account officer',
  admin: 'Administrator',
}

export const PERMISSIONS = [
  'dashboard.view',
  'branches.all', // see and filter across every branch
  'customers.view',
  'customers.create',
  'customers.edit',
  'customers.approve',
  'customers.reassign',
  'accounts.view',
  'accounts.open',
  'accounts.freeze',
  'accounts.request_close',
  'thrift_plans.view',
  'thrift_plans.manage',
  'loan_products.view',
  'loan_products.manage',
  'loans.view',
  'loans.apply',
  'loans.approve',
  'loans.disburse',
  'remittance.view',
  'remittance.confirm',
  'transactions.view',
  'transactions.post',
  'transactions.request_reversal',
  'approvals.view',
  'approvals.decide',
  'reports.view',
  'branches.manage',
  'staff.view',
  'staff.manage',
  'staff.permissions', // add staff and choose their permissions
  'audit.view',
  'settings.manage',
  'field.collect',
] as const
export type Permission = (typeof PERMISSIONS)[number]

export type StaffStatus = 'active' | 'suspended' | 'deactivated'

export interface AuthUser {
  id: Id
  staffId: string
  firstName: string
  lastName: string
  email: string
  phone: string
  role: Role
  /** Null for head-office staff (MD, admin) who work across branches. */
  branchId: Id | null
  branchName: string | null
  mustChangePassword: boolean
  permissions: Permission[]
  lastLoginAt: IsoDateTime | null
}

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginChallenge {
  challengeId: string
  otpChannel: 'sms'
  /** Masked destination, e.g. "0803 ••• 4567". */
  destinationHint: string
  /** Seconds before another code can be requested. */
  resendAfter: number
}

export interface TokenResponse {
  access: string
  user: AuthUser
}

export interface OtpVerifyRequest {
  challengeId: string
  code: string
}

export interface ChangePasswordRequest {
  currentPassword: string
  newPassword: string
}

export interface PasswordResetConfirmRequest {
  uid: string
  token: string
  newPassword: string
}
