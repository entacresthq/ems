import { decodeCharges, type WireCharges } from '@/lib/charges'
import { camelToSnake } from '@/lib/case'
import { parseDecimal, type Kobo } from '@/lib/money'
import type {
  Account,
  BusinessSettings,
  Collateral,
  LoanDetail,
  LoanProduct,
  LoanScheduleRow,
  Approval,
  DaySummary,
  Due,
  FieldToday,
  Loan,
  Portfolio,
  Remittance,
  ThriftPlan,
  Transaction,
} from '@/types'
import { decodeMoney, type Wire } from './decode'

/** Wire → app decoders for every entity that carries money. */

const money = (v: string) => parseDecimal(v)
const moneyOrNull = (v: string | null): Kobo | null => (v === null ? null : parseDecimal(v))

export const decode = {
  account: (w: WireAccount): Account => ({
    ...decodeMoney<Account>(w as unknown as Wire<Account>, ['balance']),
    target: w.target ? { ...w.target, targetAmount: money(w.target.targetAmount) } : null,
  }),
  transaction: (w: Wire<Transaction>) => decodeMoney<Transaction>(w, ['amount', 'balanceAfter']),
  loan: (w: WireLoan): Loan =>
    decodeMoney<Loan>(
      {
        ...w,
        collateral: w.collateral.map((c) => ({ ...c, estimatedValue: money(c.estimatedValue) })),
      } as Wire<Loan>,
      [
        'principal',
        'interest',
        'totalRepayable',
        'amountPaid',
        'outstanding',
        'arrears',
        'penaltyAccrued',
        'installmentAmount',
        'processingFee',
        'penaltiesCharged',
        'nextDueAmount',
      ],
    ),
  loanDetail: (w: WireLoanDetail): LoanDetail => ({
    ...decode.loan(w),
    schedule: w.schedule.map((r) =>
      decodeMoney<LoanScheduleRow>(r, ['principal', 'interest', 'amount', 'paid']),
    ),
  }),
  loanProduct: (w: WireLoanProduct): LoanProduct => ({
    ...w,
    minAmount: money(w.minAmount),
    maxAmount: money(w.maxAmount),
    processingFee:
      w.processingFee.type === 'flat'
        ? { type: 'flat', amount: money(w.processingFee.amount) }
        : w.processingFee,
    penalty:
      w.penalty.type === 'flat'
        ? { ...w.penalty, type: 'flat', amountPerDay: money(w.penalty.amountPerDay) }
        : w.penalty,
  }),
  settings: (w: Wire<BusinessSettings>): BusinessSettings => {
    const s = decodeMoney<BusinessSettings>(w, ['largeWithdrawalThreshold'])
    // Role names are data, not field names: undo the camelCase applied to every key.
    const rolePermissions = Object.fromEntries(
      Object.entries(s.rolePermissions).map(([role, perms]) => [camelToSnake(role), perms]),
    ) as BusinessSettings['rolePermissions']
    return {
      ...s,
      rolePermissions,
      transactionCharges: decodeCharges(w.transactionCharges as unknown as WireCharges | undefined),
    }
  },
  thriftPlan: (w: WireThriftPlan): ThriftPlan => ({
    ...w,
    contributionAmount: money(w.contributionAmount),
    commission:
      w.commission.type === 'flat'
        ? { type: 'flat', amount: money(w.commission.amount) }
        : w.commission,
  }),
  due: (w: Wire<Due>) => decodeMoney<Due>(w, ['amountDue', 'arrears', 'collectedToday']),
  today: (w: WireToday): FieldToday => ({
    ...w,
    items: w.items.map((i) => ({ ...i, dues: i.dues.map(decode.due) })),
  }),
  portfolio: (w: WirePortfolio): Portfolio => ({
    customers: w.customers,
    accounts: w.accounts.map(decode.account),
    loans: w.loans.map(decode.loan),
  }),
  remittance: (w: WireRemittance): Remittance => ({
    ...w,
    expectedCash: money(w.expectedCash),
    transferTotal: money(w.transferTotal),
    cashReceived: moneyOrNull(w.cashReceived),
    variance: moneyOrNull(w.variance),
  }),
  approval: (w: WireApproval): Approval => ({ ...w, amount: moneyOrNull(w.amount) }),
  daySummary: (w: WireDaySummary): DaySummary => ({
    ...w,
    totalCollected: money(w.totalCollected),
    cashTotal: money(w.cashTotal),
    transferTotal: money(w.transferTotal),
    missed: w.missed.map((m) => ({ ...m, amountDue: money(m.amountDue) })),
    remittance: w.remittance ? decode.remittance(w.remittance) : null,
  }),
}

export type WireLoan = Omit<Wire<Loan>, 'collateral'> & {
  collateral: (Omit<Collateral, 'estimatedValue'> & { estimatedValue: string })[]
}
export type WireLoanDetail = WireLoan & { schedule: Wire<LoanScheduleRow>[] }

export type WireAccount = Omit<Wire<Account>, 'target'> & {
  target: (Omit<NonNullable<Account['target']>, 'targetAmount'> & { targetAmount: string }) | null
}

export type WireLoanProduct = Omit<
  LoanProduct,
  'minAmount' | 'maxAmount' | 'processingFee' | 'penalty'
> & {
  minAmount: string
  maxAmount: string
  processingFee:
    { type: 'none' } | { type: 'percentage'; percent: string } | { type: 'flat'; amount: string }
  penalty: { graceDays: number; capPercent: string } & (
    { type: 'percentage'; percentPerDay: string } | { type: 'flat'; amountPerDay: string }
  )
}

export type WireThriftPlan = Omit<ThriftPlan, 'contributionAmount' | 'commission'> & {
  contributionAmount: string
  commission:
    | { type: 'first_contribution' }
    | { type: 'percentage'; percent: string }
    | { type: 'flat'; amount: string }
}
export type WireToday = Omit<FieldToday, 'items'> & {
  items: (Omit<FieldToday['items'][number], 'dues'> & { dues: Wire<Due>[] })[]
}
export type WirePortfolio = Omit<Portfolio, 'accounts' | 'loans'> & {
  accounts: WireAccount[]
  loans: WireLoan[]
}
export type WireRemittance = Omit<
  Remittance,
  'expectedCash' | 'transferTotal' | 'cashReceived' | 'variance'
> & {
  expectedCash: string
  transferTotal: string
  cashReceived: string | null
  variance: string | null
}
export type WireApproval = Omit<Approval, 'amount'> & { amount: string | null }
export type WireDaySummary = Omit<
  DaySummary,
  'totalCollected' | 'cashTotal' | 'transferTotal' | 'missed' | 'remittance'
> & {
  totalCollected: string
  cashTotal: string
  transferTotal: string
  missed: (Omit<DaySummary['missed'][number], 'amountDue'> & { amountDue: string })[]
  remittance: WireRemittance | null
}
