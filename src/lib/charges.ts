import type { AccountType, TransactionCharges, WithdrawalCharge } from '@/types'
import { kobo, parseDecimal, toDecimal, ZERO, type Kobo } from './money'

/**
 * Withdrawal charges, shared by the server (which posts them) and the screens
 * (which show them before anyone confirms), so both always agree.
 */

export const NO_CHARGES: TransactionCharges = {
  savingsWithdrawal: { type: 'none' },
  targetWithdrawal: { type: 'none' },
}

/** The rule for withdrawing from this kind of account, if it has one. */
export function withdrawalRule(
  charges: TransactionCharges | undefined,
  accountType: AccountType,
): WithdrawalCharge | null {
  if (!charges) return null
  if (accountType === 'savings') return charges.savingsWithdrawal
  if (accountType === 'target') return charges.targetWithdrawal
  return null
}

/** What withdrawing `amount` costs. A percentage is rounded to the nearest kobo. */
export function chargeFor(amount: Kobo, rule: WithdrawalCharge | null): Kobo {
  if (!rule || amount <= 0) return ZERO
  if (rule.type === 'flat') return rule.amount
  if (rule.type === 'percentage') {
    const charge = kobo(Math.round((amount * Number(rule.percent)) / 100))
    return rule.cap !== null && charge > rule.cap ? rule.cap : charge
  }
  return ZERO
}

/** e.g. "1% (at most ₦500)", "₦100 flat", "None". */
export function describeCharge(rule: WithdrawalCharge, format: (k: Kobo) => string): string {
  if (rule.type === 'flat') return `${format(rule.amount)} per withdrawal`
  if (rule.type === 'percentage')
    return `${Number(rule.percent)}% of the amount${rule.cap !== null ? `, at most ${format(rule.cap)}` : ''}`
  return 'No charge'
}

// ── On the wire: money as decimal strings, like every other amount ──────────

type WireCharge =
  | { type: 'none' }
  | { type: 'percentage'; percent: string; cap: string | null }
  | { type: 'flat'; amount: string }

export type WireCharges = Record<keyof TransactionCharges, WireCharge>

const encodeOne = (rule: WithdrawalCharge): WireCharge =>
  rule.type === 'flat'
    ? { type: 'flat', amount: toDecimal(rule.amount) }
    : rule.type === 'percentage'
      ? { ...rule, cap: rule.cap === null ? null : toDecimal(rule.cap) }
      : rule

const decodeOne = (rule: WireCharge): WithdrawalCharge =>
  rule.type === 'flat'
    ? { type: 'flat', amount: parseDecimal(rule.amount) }
    : rule.type === 'percentage'
      ? { ...rule, cap: rule.cap === null ? null : parseDecimal(rule.cap) }
      : { type: 'none' }

export const encodeCharges = (c: TransactionCharges): WireCharges => ({
  savingsWithdrawal: encodeOne(c.savingsWithdrawal),
  targetWithdrawal: encodeOne(c.targetWithdrawal),
})

export const decodeCharges = (c: WireCharges | undefined): TransactionCharges =>
  c
    ? {
        savingsWithdrawal: decodeOne(c.savingsWithdrawal),
        targetWithdrawal: decodeOne(c.targetWithdrawal),
      }
    : NO_CHARGES
