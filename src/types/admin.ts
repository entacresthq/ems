import type { Kobo } from '@/lib/money'
import type { Permission, Role } from './auth'
import type { Id, IsoDate, IsoDateTime, ListParams } from './common'

export const SMS_TEMPLATE_KEYS = [
  'collection_receipt',
  'loan_disbursed',
  'repayment_reminder',
  'arrears_reminder',
  'thrift_payout',
  'login_otp',
] as const
export type SmsTemplateKey = (typeof SMS_TEMPLATE_KEYS)[number]

export interface SmsTemplate {
  key: SmsTemplateKey
  label: string
  /** When it is sent. */
  trigger: string
  body: string
  /** Placeholders available in this template, e.g. {customer_name}. */
  placeholders: string[]
  enabled: boolean
}

export interface Holiday {
  date: IsoDate
  name: string
}

/**
 * How new account numbers are built, in this order:
 * prefix, branch code, product code, year, serial number.
 * Accounts that already exist keep the number they were given.
 */
export interface AccountNumberFormat {
  /** Up to four letters or digits, e.g. "EMS". Can be empty. */
  prefix: string
  /** Two-digit branch code. */
  includeBranch: boolean
  /** Two-digit product code (savings 10, target savings 11, or the plan or loan product code). */
  includeProduct: boolean
  /** Last two digits of the year the account is opened. */
  includeYear: boolean
  /** How many digits the running serial number has (3 to 10). */
  serialLength: number
  /** Placed between the parts. */
  separator: '' | '-'
}

/** What one withdrawal costs the customer. */
export type WithdrawalCharge =
  | { type: 'none' }
  | {
      type: 'percentage'
      /** Percent of the amount withdrawn, as a decimal string, e.g. "1.00". */
      percent: string
      /** Most charged on one withdrawal; null for no limit. */
      cap: Kobo | null
    }
  | { type: 'flat'; amount: Kobo }

/** Charges taken from the account when a customer withdraws. */
export interface TransactionCharges {
  /** Ordinary savings accounts. */
  savingsWithdrawal: WithdrawalCharge
  /** Target savings accounts. */
  targetWithdrawal: WithdrawalCharge
}

export interface BusinessSettings {
  businessName: string
  address: string
  phone: string
  email: string
  registrationNumber: string
  /** Sender ID shown on SMS, at most 11 characters. */
  smsSenderId: string
  /** 0 = Sunday … 6 = Saturday */
  workingDays: number[]
  holidays: Holiday[]
  largeWithdrawalThreshold: Kobo
  transactionCharges: TransactionCharges
  accountNumberFormat: AccountNumberFormat
  reversalWindowDays: number
  fieldSyncMaxAgeDays: number
  smsTemplates: SmsTemplate[]
  rolePermissions: Record<Role, Permission[]>
  updatedAt: IsoDateTime
  updatedByName: string | null
  /** One-off data upgrades already applied (internal). */
  migrations?: string[]
}

export type SettingsInput = Partial<Omit<BusinessSettings, 'updatedAt' | 'updatedByName'>>

export interface AuditEntry {
  id: Id
  at: IsoDateTime
  actorId: Id | null
  actorName: string
  actorRole: Role | null
  /** e.g. "loan.approve", "customer.create", "auth.login" */
  action: string
  entityType: string
  entityId: Id | null
  summary: string
  branchId: Id | null
  ipAddress: string
  userAgent: string
}

export interface AuditListParams extends ListParams {
  actor?: Id
  action?: string
  entityType?: string
  branch?: Id
  dateFrom?: IsoDate
  dateTo?: IsoDate
}

// ── Reports ───────────────────────────────────────────────────────────────

export interface ReportColumn {
  key: string
  label: string
  /** Money cells are decimal strings, like every amount from the API. */
  type: 'text' | 'number' | 'money' | 'percent' | 'date' | 'phone'
}

export type ReportCell = string | number | null

export interface ReportResult {
  key: string
  title: string
  generatedAt: IsoDateTime
  period: { from: IsoDate; to: IsoDate } | null
  columns: ReportColumn[]
  rows: Record<string, ReportCell>[]
  totals: Record<string, ReportCell> | null
  notes: string[]
}

export interface ReportQuery {
  dateFrom?: IsoDate
  dateTo?: IsoDate
  branch?: Id
  officer?: Id
  accountNumber?: string
  minDays?: number
}
