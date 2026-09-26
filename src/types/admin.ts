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
  reversalWindowDays: number
  fieldSyncMaxAgeDays: number
  smsTemplates: SmsTemplate[]
  rolePermissions: Record<Role, Permission[]>
  updatedAt: IsoDateTime
  updatedByName: string | null
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
