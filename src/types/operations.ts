import type { Kobo } from '@/lib/money'
import type { Account, Loan, PaymentMethod, Transaction } from './accounts'
import type { GeoPoint, Id, IsoDate, IsoDateTime, ListParams } from './common'
import type { Customer } from './customer'

// ── Field app ─────────────────────────────────────────────────────────────

export type DueKind = 'loan' | 'thrift'

export interface Due {
  accountId: Id
  accountNumber: string
  kind: DueKind
  productName: string
  /** What is due today (one installment or one contribution). */
  amountDue: Kobo
  /** Loans only: unpaid installments from earlier days. */
  arrears: Kobo
  /** Already recorded on the server today for this account. */
  collectedToday: Kobo
}

export interface TodayItem {
  customerId: Id
  customerName: string
  phone: string
  address: string
  area: string
  dues: Due[]
}

export interface FieldToday {
  date: IsoDate
  items: TodayItem[]
}

/** Everything an officer needs offline: their customers, accounts and loans. */
export interface Portfolio {
  customers: Customer[]
  accounts: Account[]
  loans: Loan[]
}

export interface CollectionRequest {
  idempotencyKey: string
  accountId: Id
  amount: Kobo
  paymentMethod: PaymentMethod
  collectedAt: IsoDateTime
  location: GeoPoint | null
}

export interface CollectionResponse {
  transaction: Transaction
  receipt: { smsStatus: 'sent' | 'queued' | 'failed'; phone: string }
}

export interface DaySummary {
  date: IsoDate
  totalCollected: Kobo
  cashTotal: Kobo
  transferTotal: Kobo
  collectionsCount: number
  customersDue: number
  customersVisited: number
  missed: { customerId: Id; customerName: string; area: string; amountDue: Kobo }[]
  remittance: Remittance | null
}

// ── Remittance ────────────────────────────────────────────────────────────

export type RemittanceStatus = 'not_submitted' | 'submitted' | 'confirmed'

/** One officer's cash for one day. Rows exist even before the officer submits. */
export interface Remittance {
  id: Id | null
  date: IsoDate
  officerId: Id
  officerName: string
  branchId: Id
  branchName: string
  collectionsCount: number
  /** Cash the system says the officer collected. */
  expectedCash: Kobo
  /** Transfers go straight to the bank; they are listed, not counted in cash. */
  transferTotal: Kobo
  status: RemittanceStatus
  submittedAt: IsoDateTime | null
  cashReceived: Kobo | null
  /** cashReceived − expectedCash. Negative means cash is short. */
  variance: Kobo | null
  confirmedByName: string | null
  confirmedAt: IsoDateTime | null
  note: string
}

export interface RemittanceListParams {
  date: IsoDate
  branch?: Id
}

// ── Approvals ─────────────────────────────────────────────────────────────

export type ApprovalType =
  | 'customer_registration'
  | 'transaction_reversal'
  | 'account_closure'
  | 'large_withdrawal'
  | 'loan_application'
  | 'loan_extension'

export const APPROVAL_TYPE_LABELS: Record<ApprovalType, string> = {
  customer_registration: 'New customer',
  transaction_reversal: 'Reversal',
  account_closure: 'Account closure',
  large_withdrawal: 'Large withdrawal',
  loan_application: 'Loan',
  loan_extension: 'Loan extension',
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface Approval {
  id: Id
  type: ApprovalType
  status: ApprovalStatus
  /** One line saying what is being approved. */
  subject: string
  amount: Kobo | null
  branchId: Id
  branchName: string
  customerId: Id | null
  customerName: string | null
  accountId: Id | null
  transactionId: Id | null
  loanId: Id | null
  requestedById: Id
  requestedByName: string
  requestedAt: IsoDateTime
  reason: string
  decidedByName: string | null
  decidedAt: IsoDateTime | null
  decisionNote: string
}

export interface ApprovalListParams extends ListParams {
  status?: ApprovalStatus
  type?: ApprovalType
  branch?: Id
  customer?: Id
  account?: Id
  transaction?: Id
  loan?: Id
}

export interface CounterPostingRequest {
  accountId: Id
  type: 'deposit' | 'withdrawal' | 'thrift_contribution' | 'loan_repayment'
  amount: Kobo
  paymentMethod: PaymentMethod
  narration: string
}

/** Counter postings either post at once or, for large withdrawals, wait for approval. */
export type CounterPostingResponse =
  | { status: 'posted'; transaction: Transaction }
  | { status: 'pending_approval'; approval: Approval }

export type { ListParams }
