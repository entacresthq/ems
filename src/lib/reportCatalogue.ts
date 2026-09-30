/** Every report, shared by the report list, the report page and the API. */

export type ReportFilter = 'period' | 'officer' | 'account' | 'minDays'

export interface ReportDefinition {
  key: string
  title: string
  group: 'Performance' | 'Transactions and income' | 'Loans' | 'Accounts'
  description: string
  filters: ReportFilter[]
}

export const REPORTS: ReportDefinition[] = [
  {
    key: 'staff-performance',
    title: 'Staff performance',
    group: 'Performance',
    description: 'Collections, portfolio and PAR for each officer, with remittance shortfalls.',
    filters: ['period', 'officer'],
  },
  {
    key: 'branch-performance',
    title: 'Branch performance',
    group: 'Performance',
    description: 'Customers, collections, disbursements, portfolio, PAR and income by branch.',
    filters: ['period'],
  },
  {
    key: 'transactions-summary',
    title: 'Transactions by branch and officer',
    group: 'Transactions and income',
    description: 'Count and value of each transaction type, by branch and officer.',
    filters: ['period', 'officer'],
  },
  {
    key: 'income',
    title: 'Income overview',
    group: 'Transactions and income',
    description:
      'Interest, processing fees, penalties, thrift commissions and withdrawal charges by branch.',
    filters: ['period'],
  },
  {
    key: 'loan-portfolio',
    title: 'Loan portfolio',
    group: 'Loans',
    description: 'By product: loans disbursed, balanced and unbalanced (in arrears), with amounts.',
    filters: ['period', 'officer'],
  },
  {
    key: 'loan-summary',
    title: 'Loan summary',
    group: 'Loans',
    description: 'Every loan disbursed in the period with what has been paid and what is left.',
    filters: ['period', 'officer'],
  },
  {
    key: 'defaulters',
    title: 'Defaulters',
    group: 'Loans',
    description: 'Borrowers behind by at least the chosen number of days, with guarantor contacts.',
    filters: ['officer', 'minDays'],
  },
  {
    key: 'loans-overdue',
    title: 'Loans overdue',
    group: 'Loans',
    description: 'Loans past their final installment date that still have a balance.',
    filters: ['officer'],
  },
  {
    key: 'account-balances',
    title: 'Account types with balances',
    group: 'Accounts',
    description: 'Number of accounts and total balance by type and status.',
    filters: [],
  },
  {
    key: 'dormant-accounts',
    title: 'Dormant accounts',
    group: 'Accounts',
    description: 'Accounts marked dormant, with their last activity and balance.',
    filters: ['officer'],
  },
  {
    key: 'closed-accounts',
    title: 'Closed accounts',
    group: 'Accounts',
    description: 'Accounts closed in the period.',
    filters: ['period', 'officer'],
  },
  {
    key: 'statement',
    title: 'Statement of account',
    group: 'Accounts',
    description: 'Opening balance, every transaction and closing balance for one account.',
    filters: ['account', 'period'],
  },
]

export const reportByKey = (key: string) => REPORTS.find((r) => r.key === key)
