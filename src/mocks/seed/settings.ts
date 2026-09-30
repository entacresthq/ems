import { ROLE_PERMISSIONS } from '@/lib/permissions'
import { naira } from '@/lib/money'
import type { BusinessSettings, Holiday, Role, SmsTemplate } from '@/types'
import { DEFAULT_ACCOUNT_NUMBER_FORMAT } from '@/lib/accountNumber'

/**
 * Nigerian public holidays for 2026. Islamic holidays depend on the moon
 * sighting, so the dates are estimates for an administrator to confirm.
 */
export const HOLIDAYS_2026: Holiday[] = [
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-03-20', name: 'Eid-el-Fitr (estimated)' },
  { date: '2026-04-03', name: 'Good Friday' },
  { date: '2026-04-06', name: 'Easter Monday' },
  { date: '2026-05-01', name: "Workers' Day" },
  { date: '2026-05-27', name: 'Eid-el-Kabir (estimated)' },
  { date: '2026-06-12', name: 'Democracy Day' },
  { date: '2026-08-26', name: 'Eid-el-Maulud (estimated)' },
  { date: '2026-10-01', name: 'Independence Day' },
  { date: '2026-12-25', name: 'Christmas Day' },
  { date: '2026-12-26', name: 'Boxing Day' },
]

export const DEFAULT_SMS_TEMPLATES: SmsTemplate[] = [
  {
    key: 'collection_receipt',
    label: 'Collection receipt',
    trigger: 'An officer records a loan repayment or thrift contribution.',
    body: 'EMS: {amount} received for {account_type} {account_number} on {date}. Balance {balance}. Ref {reference}. Officer: {officer_name}.',
    placeholders: [
      '{customer_name}',
      '{amount}',
      '{account_type}',
      '{account_number}',
      '{date}',
      '{balance}',
      '{reference}',
      '{officer_name}',
    ],
    enabled: true,
  },
  {
    key: 'loan_disbursed',
    label: 'Loan disbursed',
    trigger: 'A cashier disburses a loan.',
    body: 'EMS: Dear {customer_name}, your loan {loan_number} of {amount} has been paid out. First repayment of {installment} is due {due_date}.',
    placeholders: ['{customer_name}', '{loan_number}', '{amount}', '{installment}', '{due_date}'],
    enabled: true,
  },
  {
    key: 'repayment_reminder',
    label: 'Repayment reminder',
    trigger: 'The day before a weekly or monthly installment is due.',
    body: 'EMS: Dear {customer_name}, your repayment of {installment} on loan {loan_number} is due {due_date}. Please have it ready for your officer.',
    placeholders: ['{customer_name}', '{installment}', '{loan_number}', '{due_date}'],
    enabled: true,
  },
  {
    key: 'arrears_reminder',
    label: 'Arrears reminder',
    trigger: 'Each Monday while a loan is in arrears.',
    body: 'EMS: Dear {customer_name}, loan {loan_number} is {days_late} days behind with {arrears} unpaid. Please pay to avoid further penalties.',
    placeholders: ['{customer_name}', '{loan_number}', '{days_late}', '{arrears}'],
    enabled: true,
  },
  {
    key: 'thrift_payout',
    label: 'Thrift payout',
    trigger: 'A thrift cycle is paid out.',
    body: 'EMS: Dear {customer_name}, your thrift payout of {amount} for account {account_number} has been made. Thank you for saving with us.',
    placeholders: ['{customer_name}', '{amount}', '{account_number}'],
    enabled: true,
  },
  {
    key: 'login_otp',
    label: 'Sign-in code',
    trigger: 'A staff member signs in.',
    body: 'EMS: Your sign-in code is {code}. It expires in 5 minutes. Do not share it with anyone.',
    placeholders: ['{code}'],
    enabled: true,
  },
]

export function defaultSettings(updatedAt: string): BusinessSettings {
  return {
    businessName: 'Entacrest MFB Solution',
    address: '24 Idimu Road, Egbeda, Lagos',
    phone: '08091234500',
    email: 'info@ems.ng',
    registrationNumber: 'LSCS 14872',
    smsSenderId: 'EMS',
    workingDays: [1, 2, 3, 4, 5, 6],
    holidays: HOLIDAYS_2026,
    largeWithdrawalThreshold: naira(500_000),
    accountNumberFormat: { ...DEFAULT_ACCOUNT_NUMBER_FORMAT },
    reversalWindowDays: 30,
    fieldSyncMaxAgeDays: 3,
    smsTemplates: DEFAULT_SMS_TEMPLATES,
    rolePermissions: Object.fromEntries(
      Object.entries(ROLE_PERMISSIONS).map(([role, perms]) => [role, [...perms]]),
    ) as BusinessSettings['rolePermissions'] & Record<Role, never[]>,
    updatedAt,
    updatedByName: null,
  }
}
