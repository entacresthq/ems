import { DEFAULT_ACCOUNT_NUMBER_FORMAT } from '@/lib/accountNumber'
import { NO_CHARGES } from '@/lib/charges'
import type { Role } from '@/types'
import type { MockDb } from './seed/generate'

type Legacy = Record<string, unknown>

/**
 * Bring records saved by an older version up to the current shape.
 *
 * Also covers later additions: the account number format, target savings goals
 * and guarantor ids, photos and signatures.
 *
 * Before loan kinds existed, every product was a cash loan with a monthly
 * interest rate, a percentage processing fee and a percentage-a-day penalty.
 * Safe to run on current data: it only fills in what is missing.
 */
export function migrateLoanRecords(data: MockDb): void {
  migrateOtherRecords(data)
  for (const raw of data.loanProducts as unknown as Legacy[]) {
    raw.kind ??= 'cash'
    raw.interestBasis ??= 'monthly'
    if (raw.ratePercent === undefined && raw.monthlyRatePercent !== undefined) {
      raw.ratePercent = raw.monthlyRatePercent
    }
    delete raw.monthlyRatePercent
    if (raw.processingFee === undefined) {
      const percent = String(raw.processingFeePercent ?? '0.00')
      raw.processingFee = Number(percent) > 0 ? { type: 'percentage', percent } : { type: 'none' }
    }
    delete raw.processingFeePercent
    const penalty = (raw.penalty ?? {}) as Legacy
    penalty.type ??= 'percentage'
    raw.penalty = penalty
  }
  for (const raw of data.loans as unknown as Legacy[]) {
    raw.kind ??= 'cash'
    raw.interestBasis ??= 'monthly'
    if (raw.ratePercent === undefined && raw.monthlyRatePercent !== undefined) {
      raw.ratePercent = raw.monthlyRatePercent
    }
    delete raw.monthlyRatePercent
    raw.itemDescription ??= null
    raw.supplierName ??= null
  }
}

let counter = 0
/** Ids for guarantors saved before they had one. Unique within a run. */
const legacyId = () =>
  globalThis.crypto?.randomUUID?.() ?? `g-${Date.now().toString(36)}-${(counter++).toString(36)}`

function migrateGuarantors(list: unknown): void {
  for (const g of (list ?? []) as Legacy[]) {
    g.id ??= legacyId()
    g.photoUrl ??= null
    g.signatureUrl ??= null
  }
}

/**
 * Editing posted transactions arrived after some businesses were set up. Give it
 * once to the MD and general-manager roles and to existing general managers;
 * the marker stops it coming back if the MD later takes it away from someone.
 */
function grantTransactionEditing(data: MockDb): void {
  const done = (data.settings.migrations ??= [])
  const matrix = data.settings.rolePermissions
  const grant = (marker: string, roles: readonly Role[], staffRoles: readonly Role[]) => {
    if (done.includes(marker)) return
    for (const role of roles)
      if (matrix[role] && !matrix[role].includes('transactions.edit'))
        matrix[role].push('transactions.edit')
    for (const s of data.staff)
      if (staffRoles.includes(s.role) && !s.permissions.includes('transactions.edit'))
        s.permissions.push('transactions.edit')
    done.push(marker)
  }
  grant('transactions.edit', ['md', 'general_manager'], ['general_manager'])
  // Branch managers were added later.
  grant('transactions.edit.branch_manager', ['branch_manager'], ['branch_manager'])
}

function migrateOtherRecords(data: MockDb): void {
  const settings = data.settings as unknown as Legacy
  settings.accountNumberFormat ??= { ...DEFAULT_ACCOUNT_NUMBER_FORMAT }
  settings.transactionCharges ??= structuredClone(NO_CHARGES)
  grantTransactionEditing(data)
  for (const raw of data.accounts as unknown as Legacy[]) raw.target ??= null
  for (const raw of data.customers as unknown as Legacy[]) migrateGuarantors(raw.guarantors)
  for (const raw of data.loans as unknown as Legacy[]) migrateGuarantors(raw.guarantors)
}
