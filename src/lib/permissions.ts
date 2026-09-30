import { PERMISSIONS, type AuthUser, type Permission, type Role } from '@/types'

/**
 * Default permissions available to each role. The MD can change them in Settings.
 * Each staff member then gets some or all of their role's permissions when they
 * are added. The backend is the source of truth and returns `permissions` on the user.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  md: PERMISSIONS.filter((p) => p !== 'field.collect'),
  // Headquarters: every operation in every branch, and adding staff. Settings and
  // branch set-up stay with the MD and administrators.
  general_manager: PERMISSIONS.filter(
    (p) => !['field.collect', 'settings.manage', 'branches.manage'].includes(p),
  ),
  branch_manager: [
    'dashboard.view',
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
    'loan_products.view',
    'loans.view',
    'loans.apply',
    'loans.approve',
    'remittance.view',
    'transactions.view',
    'transactions.request_reversal',
    'transactions.edit',
    'approvals.view',
    'approvals.decide',
    'reports.view',
    'staff.view',
    'audit.view',
  ],
  accountant: [
    'dashboard.view',
    'customers.view',
    'accounts.view',
    'thrift_plans.view',
    'loan_products.view',
    'loans.view',
    'remittance.view',
    'remittance.confirm',
    'transactions.view',
    'transactions.request_reversal',
    'approvals.view',
    'reports.view',
  ],
  cashier: [
    'dashboard.view',
    'customers.view',
    'customers.create',
    'accounts.view',
    'accounts.open',
    'accounts.request_close',
    'thrift_plans.view',
    'loan_products.view',
    'loans.view',
    'loans.disburse',
    'transactions.view',
    'transactions.post',
    'transactions.request_reversal',
    'approvals.view',
  ],
  account_officer: [
    'field.collect',
    'customers.view',
    'customers.create',
    'accounts.view',
    'thrift_plans.view',
  ],
  admin: [
    'dashboard.view',
    'branches.all',
    'thrift_plans.view',
    'thrift_plans.manage',
    'loan_products.view',
    'loan_products.manage',
    'branches.manage',
    'staff.view',
    'staff.manage',
    'audit.view',
    'settings.manage',
  ],
}

/** Permissions a role can never be without. */
export const REQUIRED_PERMISSIONS: Partial<Record<Role, readonly Permission[]>> = {
  account_officer: ['field.collect'],
}

/**
 * The permissions someone may hand out for a role: what the role allows, limited
 * to what they hold themselves. Nobody at head office collects in the field, so
 * field.collect is always grantable to roles that allow it.
 */
export function grantablePermissions(
  assigner: readonly Permission[],
  available: readonly Permission[],
): Permission[] {
  return available.filter((p) => p === 'field.collect' || assigner.includes(p))
}

/**
 * The permissions a staff member ends up with. Required permissions are always on.
 * Permissions the assigner can't grant stay exactly as they were, so a manager can
 * neither add nor remove access they don't have themselves.
 */
export function assignPermissions({
  role,
  available,
  assigner,
  requested,
  existing,
}: {
  role: Role
  available: readonly Permission[]
  assigner: readonly Permission[]
  requested: readonly Permission[]
  existing: readonly Permission[]
}): Permission[] {
  const grantable = new Set(grantablePermissions(assigner, available))
  const keep = new Set<Permission>([
    ...(REQUIRED_PERMISSIONS[role] ?? []),
    ...existing.filter((p) => available.includes(p) && !grantable.has(p)),
    ...requested.filter((p) => grantable.has(p)),
  ])
  return PERMISSIONS.filter((p) => keep.has(p))
}

export function hasPermission(user: Pick<AuthUser, 'permissions'> | null, permission: Permission) {
  return user?.permissions.includes(permission) ?? false
}

export function isFieldUser(user: Pick<AuthUser, 'role'>): boolean {
  return user.role === 'account_officer'
}

/** Where a user lands after signing in. */
export function homePathFor(user: Pick<AuthUser, 'role'>): string {
  return isFieldUser(user) ? '/field/today' : '/'
}
