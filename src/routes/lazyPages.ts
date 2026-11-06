import { lazy, type ComponentType } from 'react'

/**
 * Back-office screens load on first visit, so staff download only the areas
 * they open. The field app is loaded up front so it works offline.
 */
function page<M extends Record<string, unknown>, K extends keyof M & string>(
  loader: () => Promise<M>,
  name: K,
) {
  return lazy(async () => ({ default: (await loader())[name] as ComponentType }))
}

export const CustomersPage = page(
  () => import('@/features/customers/CustomersPage'),
  'CustomersPage',
)
export const CustomerFormPage = page(
  () => import('@/features/customers/CustomerFormPage'),
  'CustomerFormPage',
)
export const CustomerDetailPage = page(
  () => import('@/features/customers/CustomerDetailPage'),
  'CustomerDetailPage',
)
export const AccountsPage = page(() => import('@/features/accounts/AccountsPage'), 'AccountsPage')
export const AccountDetailPage = page(
  () => import('@/features/accounts/AccountDetailPage'),
  'AccountDetailPage',
)
export const ThriftPlansPage = page(
  () => import('@/features/products/ThriftPlansPage'),
  'ThriftPlansPage',
)
export const RemittancePage = page(
  () => import('@/features/remittance/RemittancePage'),
  'RemittancePage',
)
export const TransactionsPage = page(
  () => import('@/features/transactions/TransactionsPage'),
  'TransactionsPage',
)
export const ApprovalsPage = page(
  () => import('@/features/approvals/ApprovalsPage'),
  'ApprovalsPage',
)
export const LoansPage = page(() => import('@/features/loans/LoansPage'), 'LoansPage')
export const LoanApplicationPage = page(
  () => import('@/features/loans/LoanApplicationPage'),
  'LoanApplicationPage',
)
export const LoanDetailPage = page(
  () => import('@/features/loans/LoanDetailPage'),
  'LoanDetailPage',
)
export const LoanProductsPage = page(
  () => import('@/features/loans/LoanProductsPage'),
  'LoanProductsPage',
)
export const ReportsPage = page(() => import('@/features/reports/ReportsPage'), 'ReportsPage')
export const ReportPage = page(() => import('@/features/reports/ReportPage'), 'ReportPage')
export const AuditLogPage = page(() => import('@/features/admin/AuditLogPage'), 'AuditLogPage')
export const BranchesPage = page(() => import('@/features/admin/BranchesPage'), 'BranchesPage')
export const StaffPage = page(() => import('@/features/admin/StaffPage'), 'StaffPage')
export const StaffDetailPage = page(
  () => import('@/features/admin/StaffDetailPage'),
  'StaffDetailPage',
)
export const SettingsPage = page(() => import('@/features/admin/SettingsPage'), 'SettingsPage')
export const SubscriptionPage = page(
  () => import('@/features/subscription/SubscriptionPage'),
  'SubscriptionPage',
)
export const UiKitPage = page(() => import('@/features/dev/UiKitPage'), 'UiKitPage')
