import type { Kobo } from '@/lib/money'
import type { GeoPoint, Id, IsoDate, IsoDateTime, ListParams } from './common'
import type { Guarantor } from './customer'
import type { InterestMethod, RepaymentFrequency } from './products'

export type AccountType = 'savings' | 'thrift' | 'loan'
export type AccountStatus = 'active' | 'dormant' | 'frozen' | 'closed'

export interface Account {
  id: Id
  /** 10 digits: branch code (2) + product code (2) + serial (6). */
  accountNumber: string
  type: AccountType
  customerId: Id
  customerName: string
  branchId: Id
  officerId: Id
  /** Thrift plan or loan product; null for plain savings. */
  productId: Id | null
  productName: string | null
  status: AccountStatus
  /** For loan accounts this is the outstanding balance. */
  balance: Kobo
  openedAt: IsoDateTime
  closedAt: IsoDateTime | null
  lastTransactionAt: IsoDateTime | null
}

export interface AccountListParams extends ListParams {
  customer?: Id
  branch?: Id
  officer?: Id
  type?: AccountType
  status?: AccountStatus
}

export type LoanStatus =
  'pending_approval' | 'approved' | 'rejected' | 'active' | 'closed' | 'written_off'

export interface Collateral {
  description: string
  estimatedValue: Kobo
  /** Receipt, title or registration number. */
  documentRef: string
}

export interface Loan {
  id: Id
  loanNumber: string
  /** Created at disbursement; null while the application is being considered. */
  accountId: Id | null
  accountNumber: string | null
  customerId: Id
  customerName: string
  productId: Id
  productName: string
  branchId: Id
  officerId: Id
  principal: Kobo
  interest: Kobo
  totalRepayable: Kobo
  amountPaid: Kobo
  outstanding: Kobo
  arrears: Kobo
  penaltyAccrued: Kobo
  daysInArrears: number
  frequency: RepaymentFrequency
  installmentAmount: Kobo
  installmentCount: number
  interestMethod: InterestMethod
  monthlyRatePercent: string
  processingFee: Kobo
  /** Penalties already added to the balance. */
  penaltiesCharged: Kobo
  status: LoanStatus
  purpose: string
  guarantors: Guarantor[]
  collateral: Collateral[]
  /** The loan this one settles (top-up). */
  topUpOfId: Id | null
  topUpOfNumber: string | null
  extensions: number
  nextDueDate: IsoDate | null
  nextDueAmount: Kobo | null
  appliedByName: string
  approvedByName: string | null
  disbursedByName: string | null
  disbursedAt: IsoDateTime | null
  maturityDate: IsoDate | null
  closedAt: IsoDateTime | null
  createdAt: IsoDateTime
}

export interface LoanScheduleRow {
  number: number
  dueDate: IsoDate
  principal: Kobo
  interest: Kobo
  amount: Kobo
  paid: Kobo
  status: 'paid' | 'part_paid' | 'overdue' | 'due_today' | 'upcoming'
}

export interface LoanDetail extends Loan {
  schedule: LoanScheduleRow[]
}

export interface LoanListParams extends ListParams {
  branch?: Id
  officer?: Id
  customer?: Id
  account?: Id
  product?: Id
  status?: LoanStatus
  /** "arrears" = in arrears; "expiring" = final installment within 14 days or passed with a balance. */
  view?: 'arrears' | 'expiring'
}

export interface LoanApplicationInput {
  customerId: Id
  productId: Id
  principal: Kobo
  installmentCount: number
  purpose: string
  collateral: Collateral[]
  topUpOfId: Id | null
}

export type TransactionType =
  | 'thrift_contribution'
  | 'loan_repayment'
  | 'deposit'
  | 'withdrawal'
  | 'disbursement'
  | 'processing_fee'
  | 'penalty'
  | 'thrift_commission'
  | 'thrift_payout'
  | 'reversal'

export type TransactionChannel = 'field' | 'counter' | 'system'
export type PaymentMethod = 'cash' | 'transfer'
export type TransactionStatus = 'posted' | 'pending_reversal' | 'reversed'

export interface Transaction {
  id: Id
  reference: string
  type: TransactionType
  direction: 'credit' | 'debit'
  amount: Kobo
  balanceAfter: Kobo
  accountId: Id
  accountNumber: string
  customerId: Id
  customerName: string
  branchId: Id
  /** Officer who collected it (field) or null for counter/system postings. */
  officerId: Id | null
  officerName: string | null
  postedById: Id
  channel: TransactionChannel
  paymentMethod: PaymentMethod | null
  status: TransactionStatus
  location: GeoPoint | null
  idempotencyKey: string | null
  /** Free text from the cashier, e.g. "Paid by son". */
  narration: string | null
  createdAt: IsoDateTime
}

export interface TransactionListParams extends ListParams {
  branch?: Id
  officer?: Id
  customer?: Id
  account?: Id
  type?: TransactionType
  status?: TransactionStatus
  channel?: TransactionChannel
  dateFrom?: IsoDate
  dateTo?: IsoDate
}

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  thrift_contribution: 'Thrift contribution',
  loan_repayment: 'Loan repayment',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  disbursement: 'Loan disbursement',
  processing_fee: 'Processing fee',
  penalty: 'Penalty',
  thrift_commission: 'Thrift commission',
  thrift_payout: 'Thrift payout',
  reversal: 'Reversal',
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  savings: 'Savings',
  thrift: 'Thrift',
  loan: 'Loan',
}
