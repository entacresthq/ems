import {
  ArrowLeftRight,
  BadgeCheck,
  Building2,
  ChartColumn,
  ClipboardCheck,
  FileClock,
  HandCoins,
  LayoutDashboard,
  Landmark,
  Palette,
  PiggyBank,
  Settings,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import type { Permission } from '@/types'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  permission: Permission
}

export interface NavGroup {
  label: string | null
  items: NavItem[]
}

export const BACK_OFFICE_NAV: NavGroup[] = [
  {
    label: null,
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard.view' }],
  },
  {
    label: 'Customers',
    items: [
      { to: '/customers', label: 'Customers', icon: Users, permission: 'customers.view' },
      { to: '/accounts', label: 'Accounts', icon: Wallet, permission: 'accounts.view' },
    ],
  },
  {
    label: 'Operations',
    items: [
      {
        to: '/remittance',
        label: 'Remittance',
        icon: ClipboardCheck,
        permission: 'remittance.view',
      },
      {
        to: '/transactions',
        label: 'Transactions',
        icon: ArrowLeftRight,
        permission: 'transactions.view',
      },
      { to: '/approvals', label: 'Approvals', icon: BadgeCheck, permission: 'approvals.view' },
    ],
  },
  {
    label: 'Lending and savings',
    items: [
      { to: '/loans', label: 'Loans', icon: HandCoins, permission: 'loans.view' },
      {
        to: '/loan-products',
        label: 'Loan products',
        icon: Landmark,
        permission: 'loan_products.view',
      },
      {
        to: '/thrift-plans',
        label: 'Thrift plans',
        icon: PiggyBank,
        permission: 'thrift_plans.view',
      },
    ],
  },
  {
    label: 'Oversight',
    items: [
      { to: '/reports', label: 'Reports', icon: ChartColumn, permission: 'reports.view' },
      { to: '/audit-log', label: 'Audit log', icon: FileClock, permission: 'audit.view' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { to: '/branches', label: 'Branches', icon: Building2, permission: 'branches.manage' },
      { to: '/staff', label: 'Staff', icon: UserCog, permission: 'staff.view' },
      { to: '/settings', label: 'Settings', icon: Settings, permission: 'settings.manage' },
    ],
  },
]

/** Shown only in development / mock mode. */
export const DESIGN_SYSTEM_ITEM = { to: '/ui-kit', label: 'Design system', icon: Palette }
