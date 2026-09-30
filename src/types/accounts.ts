import type { Kobo } from '@/lib/money'
import type { GeoPoint, Id, IsoDate, IsoDateTime, ListParams } from './common'
import type { Guarantor } from './customer'
import type { InterestBasis, InterestMethod, LoanKind, RepaymentFrequency } from './products'

export type AccountType = 'savings' | 'target' | 'thrift' | 'loan'
export type AccountStatus = 'active' | 'dormant' | 'frozen' | 'closed'

/** A savings goal: the customer is saving up for something. */
export interface SavingsTarget {
  /** What the customer is saving for, e.g. "School fees" or "New freezer". */
  goalName: string
  targetAmount: Kobo
  targetDate: IsoDate
  /** When on, money can't be withdrawn until the goal is reached or the target date has passed. */
  lockUntilReached: boolean
}

export interface Account {
  id: Id
  /** Built from the business's account number format (Settings). */
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
  /** Only on target savings accounts. */
  target: SavingsTarget | null
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
  kind: LoanKind
  interestMethod: InterestMethod
  interestBasis: InterestBasis
  ratePercent: string
  processingFee: Kobo
  /** BNPL only: what the company buys for the customer. */
  itemDescription: string | null
  /** BNPL only: who the company pays. */
  supplierName: string | null
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
  /** BNPL only. */
  itemDescription?: string
  supplierName?: string
}

export type TransactionType =
  | 'thrift_contribution'
  | 'loan_repayment'
  | 'deposit'
  | 'withdrawal'
  | 'withdrawal_charge'
  | 'transfer_out'
  | 'transfer_in'
  | 'disbursement'
  | 'processing_fee'
  | 'penalty'
  | 'thrift_commission'
  | 'thrift_payout'
  | 'reversal'

export type TransactionChannel = 'field' | 'counter' | 'system'
export type PaymentMethod = 'cash' | 'transfer'
export type TransactionStatus = 'posted' | 'pending_reversal' | 'reversed'

/** One correction to a posted transaction. Values are as shown to people. */
export interface TransactionEdit {
  at: IsoDateTime
  byName: string
  reason: string
  changes: { field: 'amount' | 'date' | 'paymentMethod' | 'note'; from: string; to: string }[]
}

/** What the MD or a general manager may change on a posted transaction. */
export interface TransactionEditRequest {
  amount?: Kobo
  /** New date and time, ISO. */
  createdAt?: IsoDateTime
  paymentMethod?: PaymentMethod
  narration?: string
  /** Why it is being changed. Kept with the transaction and in the audit log. */
  reason: string
}

/** Types whose amount can be corrected. Loan payouts and fees follow the loan terms. */
export const AMOUNT_EDITABLE_TYPES: readonly TransactionType[] = [
  'deposit',
  'withdrawal',
  'withdrawal_charge',
  'thrift_contribution',
  'thrift_commission',
  'thrift_payout',
  'loan_repayment',
  'penalty',
]

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
  /** On a withdrawal charge: the withdrawal it was taken for. */
  chargedOnId?: Id | null
  /** Both sides of a transfer share this id. */
  transferId?: Id | null
  /** Corrections made by the MD or a general manager, oldest first. */
  edits?: TransactionEdit[]
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
  withdrawal_charge: 'Withdrawal charge',
  transfer_out: 'Transfer out',
  transfer_in: 'Transfer in',
  disbursement: 'Loan disbursement',
  processing_fee: 'Processing fee',
  penalty: 'Penalty',
  thrift_commission: 'Thrift commission',
  thrift_payout: 'Thrift payout',
  reversal: 'Reversal',
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  savings: 'Savings',
  target: 'Target savings',
  thrift: 'Thrift',
  loan: 'Loan',
}
