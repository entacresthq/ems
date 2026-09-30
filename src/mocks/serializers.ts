import { encodeCharges, NO_CHARGES } from '@/lib/charges'
import type { JsonBodyType } from 'msw'
import { toDecimal, type Kobo } from '@/lib/money'
import type {
  Account,
  BusinessSettings,
  LoanProduct,
  Approval,
  Customer,
  DaySummary,
  Due,
  Loan,
  Remittance,
  ThriftPlan,
  TodayItem,
  Transaction,
} from '@/types'
import type { ScheduleRowStatus } from '@/lib/loans'
import type { LoanRecord } from './loanState'
import type { ApprovalRecord } from './seed/generate'
import { serialize } from './utils'

/** DRF-style serialisers: money as decimal strings, snake_case keys. */

const LOAN_MONEY: (keyof Loan)[] = [
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
]

const moneyOrNull = (v: Kobo | null) => (v === null ? null : toDecimal(v))

export const out = {
  customer: (c: Customer) => serialize(c),
  account: (a: Account) =>
    serialize(
      {
        ...a,
        target: a.target ? { ...a.target, targetAmount: toDecimal(a.target.targetAmount) } : null,
      },
      ['balance'],
    ),
  transaction: (t: Transaction) => serialize(t, ['amount', 'balanceAfter']),
  loan: (l: Loan) => {
    const { schedule: _schedule, ...rest } = l as LoanRecord
    return serialize(
      {
        ...rest,
        collateral: rest.collateral.map((c) => ({
          ...c,
          estimatedValue: toDecimal(c.estimatedValue),
        })),
      },
      LOAN_MONEY,
    )
  },
  loanDetail: (l: LoanRecord, schedule: ScheduleRowStatus[]): JsonBodyType => ({
    ...(out.loan(l) as Record<string, unknown>),
    schedule: schedule.map((r) => serialize(r, ['principal', 'interest', 'amount', 'paid'])),
  }),
  loanProduct: (p: LoanProduct) =>
    serialize(
      {
        ...p,
        processingFee:
          p.processingFee.type === 'flat'
            ? { type: 'flat', amount: toDecimal(p.processingFee.amount) }
            : p.processingFee,
        penalty:
          p.penalty.type === 'flat'
            ? { ...p.penalty, amountPerDay: toDecimal(p.penalty.amountPerDay) }
            : p.penalty,
      },
      ['minAmount', 'maxAmount'],
    ),
  settings: (s: BusinessSettings) =>
    serialize({ ...s, transactionCharges: encodeCharges(s.transactionCharges ?? NO_CHARGES) }, [
      'largeWithdrawalThreshold',
    ]),
  thriftPlan: (p: ThriftPlan) =>
    serialize(
      {
        ...p,
        commission:
          p.commission.type === 'flat'
            ? { type: 'flat', amount: toDecimal(p.commission.amount) }
            : p.commission,
      },
      ['contributionAmount'],
    ),
  due: (d: Due) => serialize(d, ['amountDue', 'arrears', 'collectedToday']),
  todayItem: (item: TodayItem) => serialize({ ...item, dues: item.dues.map((d) => out.due(d)) }),
  remittance: (r: Remittance) =>
    serialize(
      { ...r, cashReceived: moneyOrNull(r.cashReceived), variance: moneyOrNull(r.variance) },
      ['expectedCash', 'transferTotal'],
    ),
  approval: (a: ApprovalRecord | Approval) => {
    const { payload: _payload, ...rest } = a as ApprovalRecord
    return serialize({ ...rest, amount: moneyOrNull(rest.amount) })
  },
  daySummary: (s: DaySummary): JsonBodyType =>
    serialize({
      ...s,
      totalCollected: toDecimal(s.totalCollected),
      cashTotal: toDecimal(s.cashTotal),
      transferTotal: toDecimal(s.transferTotal),
      missed: s.missed.map((m) => ({ ...m, amountDue: toDecimal(m.amountDue) })),
      remittance: s.remittance ? out.remittance(s.remittance) : null,
    }),
}
