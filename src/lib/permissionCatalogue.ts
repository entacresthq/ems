import { ROLE_LABELS, type Permission, type Role } from '@/types'

export const PERMISSION_LABELS: Record<Permission, string> = {
  'dashboard.view': 'See the dashboard',
  'branches.all': 'See every branch',
  'customers.view': 'See customers',
  'customers.create': 'Register customers',
  'customers.edit': 'Edit customer details',
  'customers.approve': 'Approve new customers',
  'customers.reassign': 'Move customers between officers',
  'accounts.view': 'See accounts',
  'accounts.open': 'Open accounts',
  'accounts.freeze': 'Freeze, unfreeze and reactivate accounts',
  'accounts.request_close': 'Request account closure',
  'thrift_plans.view': 'See thrift plans',
  'thrift_plans.manage': 'Create and edit thrift plans',
  'loan_products.view': 'See loan products',
  'loan_products.manage': 'Create and edit loan products',
  'loans.view': 'See loans',
  'loans.apply': 'Apply for loans, top-ups and extensions',
  'loans.approve': 'Charge loan penalties',
  'loans.disburse': 'Pay out approved loans',
  'remittance.view': 'See remittances',
  'remittance.confirm': 'Count cash and sign off remittances',
  'transactions.view': 'See transactions',
  'transactions.post': 'Post counter transactions',
  'transactions.request_reversal': 'Request reversals',
  'approvals.view': 'See approval requests',
  'approvals.decide': 'Approve or reject requests',
  'reports.view': 'Run reports',
  'branches.manage': 'Manage branches',
  'staff.view': 'See staff',
  'staff.manage': 'Edit, suspend and reset passwords for staff',
  'staff.permissions': 'Add staff and choose their permissions',
  'audit.view': 'See the audit log',
  'settings.manage': 'Change settings',
  'field.collect': 'Use the field app',
}

/** Permissions grouped the way people think about the work. Covers every permission once. */
export const PERMISSION_GROUPS: { title: string; permissions: Permission[] }[] = [
  { title: 'General', permissions: ['dashboard.view', 'branches.all', 'reports.view'] },
  {
    title: 'Customers',
    permissions: [
      'customers.view',
      'customers.create',
      'customers.edit',
      'customers.approve',
      'customers.reassign',
    ],
  },
  {
    title: 'Accounts and thrift',
    permissions: [
      'accounts.view',
      'accounts.open',
      'accounts.freeze',
      'accounts.request_close',
      'thrift_plans.view',
      'thrift_plans.manage',
    ],
  },
  {
    title: 'Loans',
    permissions: [
      'loan_products.view',
      'loan_products.manage',
      'loans.view',
      'loans.apply',
      'loans.approve',
      'loans.disburse',
    ],
  },
  {
    title: 'Cash and transactions',
    permissions: [
      'remittance.view',
      'remittance.confirm',
      'transactions.view',
      'transactions.post',
      'transactions.request_reversal',
      'field.collect',
    ],
  },
  { title: 'Approvals', permissions: ['approvals.view', 'approvals.decide'] },
  {
    title: 'Administration',
    permissions: [
      'staff.view',
      'staff.manage',
      'staff.permissions',
      'branches.manage',
      'audit.view',
      'settings.manage',
    ],
  },
]

/** "an accountant", "a cashier". */
export function roleWithArticle(role: Role): string {
  const label = ROLE_LABELS[role].toLowerCase()
  return `${/^[aeiou]/.test(label) ? 'an' : 'a'} ${label}`
}
