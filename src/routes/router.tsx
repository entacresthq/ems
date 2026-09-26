import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom'
import { config } from '@/config'
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage'
import { LoginPage } from '@/features/auth/LoginPage'
import {
  ResetPasswordConfirmPage,
  ResetPasswordRequestPage,
} from '@/features/auth/ResetPasswordPages'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { CrashPage, NotFoundPage } from '@/features/errors/ErrorPages'
import { CollectPage, CollectPickerPage } from '@/features/field/CollectPage'
import { EndOfDayPage } from '@/features/field/EndOfDayPage'
import { FieldCustomerDetailPage, FieldCustomersPage } from '@/features/field/FieldCustomersPage'
import { FieldMePage } from '@/features/field/FieldPages'
import { RegisterCustomerPage } from '@/features/field/RegisterCustomerPage'
import { TodayPage } from '@/features/field/TodayPage'
import { Suspense } from 'react'
import { LoadingState } from '@/components/states'
import { BackOfficeShell } from '@/layouts/BackOfficeShell'
import {
  UiKitPage,
  AccountDetailPage,
  AuditLogPage,
  BranchesPage,
  SettingsPage,
  StaffDetailPage,
  StaffPage,
  AccountsPage,
  ApprovalsPage,
  CustomerDetailPage,
  CustomerFormPage,
  CustomersPage,
  LoanApplicationPage,
  LoanDetailPage,
  LoanProductsPage,
  LoansPage,
  ThriftPlansPage,
  ReportPage,
  ReportsPage,
  RemittancePage,
  TransactionsPage,
} from './lazyPages'
import { FieldShell } from '@/layouts/FieldShell'
import type { Permission } from '@/types'
import { BackOfficeOnly, FieldOnly, GuestOnly, RequireAuth, RequirePermission } from './guards'

const guarded = (path: string, permission: Permission, element: React.ReactNode): RouteObject => ({
  path,
  element: (
    <RequirePermission permission={permission}>
      <Suspense fallback={<LoadingState />}>{element}</Suspense>
    </RequirePermission>
  ),
})

export const routes: RouteObject[] = [
  {
    errorElement: <CrashPage />,
    children: [
      {
        element: <GuestOnly />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/field/login', element: <LoginPage variant="field" /> },
          { path: '/reset-password', element: <ResetPasswordRequestPage /> },
        ],
      },
      // Reachable signed in or out: the link comes from an email.
      { path: '/reset-password/confirm', element: <ResetPasswordConfirmPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: '/change-password', element: <ChangePasswordPage /> },
          {
            element: <BackOfficeOnly />,
            children: [
              {
                element: <BackOfficeShell />,
                children: [
                  guarded('/', 'dashboard.view', <DashboardPage />),
                  guarded('/customers', 'customers.view', <CustomersPage />),
                  guarded('/customers/new', 'customers.create', <CustomerFormPage />),
                  guarded('/customers/:id', 'customers.view', <CustomerDetailPage />),
                  guarded('/customers/:id/edit', 'customers.edit', <CustomerFormPage />),
                  guarded('/accounts', 'accounts.view', <AccountsPage />),
                  guarded('/accounts/:id', 'accounts.view', <AccountDetailPage />),
                  guarded('/thrift-plans', 'thrift_plans.view', <ThriftPlansPage />),
                  guarded('/remittance', 'remittance.view', <RemittancePage />),
                  guarded('/transactions', 'transactions.view', <TransactionsPage />),
                  guarded('/approvals', 'approvals.view', <ApprovalsPage />),
                  guarded('/loans', 'loans.view', <LoansPage />),
                  guarded('/loans/new', 'loans.apply', <LoanApplicationPage />),
                  guarded('/loans/:id', 'loans.view', <LoanDetailPage />),
                  guarded('/loan-products', 'loan_products.view', <LoanProductsPage />),
                  guarded('/reports', 'reports.view', <ReportsPage />),
                  guarded('/reports/:key', 'reports.view', <ReportPage />),
                  guarded('/audit-log', 'audit.view', <AuditLogPage />),
                  guarded('/branches', 'branches.manage', <BranchesPage />),
                  guarded('/staff', 'staff.view', <StaffPage />),
                  guarded('/staff/:id', 'staff.view', <StaffDetailPage />),
                  guarded('/settings', 'settings.manage', <SettingsPage />),
                  ...(import.meta.env.DEV || config.useMocks
                    ? [
                        {
                          path: '/ui-kit',
                          element: (
                            <Suspense fallback={<LoadingState />}>
                              <UiKitPage />
                            </Suspense>
                          ),
                        },
                      ]
                    : []),
                ],
              },
            ],
          },
          {
            path: '/field',
            element: <FieldOnly />,
            children: [
              {
                element: <FieldShell />,
                children: [
                  { index: true, element: <Navigate to="/field/today" replace /> },
                  { path: 'today', element: <TodayPage /> },
                  { path: 'collect', element: <CollectPickerPage /> },
                  { path: 'collect/:customerId', element: <CollectPage /> },
                  { path: 'customers', element: <FieldCustomersPage /> },
                  { path: 'customers/new', element: <RegisterCustomerPage /> },
                  { path: 'customers/:customerId', element: <FieldCustomerDetailPage /> },
                  { path: 'end-of-day', element: <EndOfDayPage /> },
                  { path: 'me', element: <FieldMePage /> },
                ],
              },
            ],
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

export const router = createBrowserRouter(routes)
