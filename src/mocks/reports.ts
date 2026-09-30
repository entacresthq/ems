import { todayIso } from '@/lib/dates'
import { kobo, parseDecimal, toDecimal, type Kobo } from '@/lib/money'
import { reportByKey } from '@/lib/reportCatalogue'
import {
  ACCOUNT_TYPE_LABELS,
  TRANSACTION_TYPE_LABELS,
  type ReportColumn,
  type ReportResult,
} from '@/types'
import { activeLoans, collectionsFor, incomeFor, officersIn, par, type Scope } from './analytics'
import { db } from './db'
import { current, lagosDay, remittanceRow, staffName } from './domain'
import { DomainError } from './domain'

export interface ReportParams extends Scope {
  from: string
  to: string
  accountNumber: string | null
  minDays: number
}

const m = (k: number) => toDecimal(kobo(k))
const sum = (xs: number[]) => xs.reduce((n, v) => n + v, 0)
const col = (key: string, label: string, type: ReportColumn['type'] = 'text'): ReportColumn => ({
  key,
  label,
  type,
})
const inPeriod = (iso: string | null, p: ReportParams) =>
  !!iso && lagosDay(iso) >= p.from && lagosDay(iso) <= p.to

type Row = Record<string, string | number | null>
type Builder = (p: ReportParams) => {
  columns: ReportColumn[]
  rows: Row[]
  totals?: Row
  notes?: string[]
}

const builders: Record<string, Builder> = {
  'staff-performance': (p) => {
    const rows = officersIn(p).map((o) => {
      const collections = collectionsFor({ branchId: null, officerId: o.id }, p.from, p.to)
      const portfolio = par(activeLoans({ branchId: null, officerId: o.id }))
      const shortfall = sum(
        db()
          .remittances.filter(
            (r) =>
              r.officerId === o.id && r.date >= p.from && r.date <= p.to && r.cashReceived !== null,
          )
          .map((r) => {
            const v = remittanceRow(o, r.date).variance ?? 0
            return v < 0 ? -v : 0
          }),
      )
      return {
        officer: staffName(o),
        branch: o.branchName,
        status: o.status,
        customers: db().customers.filter((c) => c.officerId === o.id && c.status === 'active')
          .length,
        collections: collections.length,
        collected: m(sum(collections.map((t) => t.amount))),
        activeLoans: portfolio.count,
        portfolio: portfolio.portfolio,
        par30: portfolio.par30Percent,
        shortfall: m(shortfall),
      }
    })
    return {
      columns: [
        col('officer', 'Officer'),
        col('branch', 'Branch'),
        col('status', 'Status'),
        col('customers', 'Active customers', 'number'),
        col('collections', 'Collections', 'number'),
        col('collected', 'Collected', 'money'),
        col('activeLoans', 'Active loans', 'number'),
        col('portfolio', 'Loan portfolio', 'money'),
        col('par30', 'PAR 30', 'percent'),
        col('shortfall', 'Cash shortfall', 'money'),
      ],
      rows,
      totals: {
        officer: 'Total',
        customers: sum(rows.map((r) => r.customers)),
        collections: sum(rows.map((r) => r.collections)),
        collected: m(sum(rows.map((r) => parseDecimal(String(r.collected))))),
        activeLoans: sum(rows.map((r) => r.activeLoans)),
        portfolio: m(sum(rows.map((r) => parseDecimal(String(r.portfolio))))),
        shortfall: m(sum(rows.map((r) => parseDecimal(String(r.shortfall))))),
      },
    }
  },

  'branch-performance': (p) => {
    // Headquarters holds no customers, so it has no line of its own.
    const branches = db().branches.filter(
      (b) => b.kind === 'branch' && (!p.branchId || b.id === p.branchId),
    )
    const rows = branches.map((b) => {
      const scope = { branchId: b.id }
      const collected = sum(collectionsFor(scope, p.from, p.to).map((t) => t.amount))
      const disbursed = db().loans.filter((l) => l.branchId === b.id && inPeriod(l.disbursedAt, p))
      const portfolio = par(activeLoans(scope))
      return {
        branch: b.name,
        customers: db().customers.filter((c) => c.branchId === b.id && c.status === 'active')
          .length,
        officers: db().staff.filter(
          (s) => s.branchId === b.id && s.role === 'account_officer' && s.status === 'active',
        ).length,
        collected: m(collected),
        disbursedCount: disbursed.length,
        disbursed: m(sum(disbursed.map((l) => l.principal))),
        portfolio: portfolio.portfolio,
        par30: portfolio.par30Percent,
        income: m(incomeFor(scope, p.from, p.to).total),
      }
    })
    const k = (key: keyof (typeof rows)[number]) =>
      m(sum(rows.map((r) => parseDecimal(String(r[key])))))
    return {
      columns: [
        col('branch', 'Branch'),
        col('customers', 'Active customers', 'number'),
        col('officers', 'Officers', 'number'),
        col('collected', 'Collected', 'money'),
        col('disbursedCount', 'Loans disbursed', 'number'),
        col('disbursed', 'Amount disbursed', 'money'),
        col('portfolio', 'Loan portfolio', 'money'),
        col('par30', 'PAR 30', 'percent'),
        col('income', 'Income', 'money'),
      ],
      rows,
      totals: {
        branch: 'Total',
        customers: sum(rows.map((r) => r.customers)),
        officers: sum(rows.map((r) => r.officers)),
        collected: k('collected'),
        disbursedCount: sum(rows.map((r) => r.disbursedCount)),
        disbursed: k('disbursed'),
        portfolio: k('portfolio'),
        income: k('income'),
      },
    }
  },

  'transactions-summary': (p) => {
    const txns = db().transactions.filter(
      (t) =>
        t.status !== 'reversed' &&
        (!p.branchId || t.branchId === p.branchId) &&
        (!p.officerId || t.officerId === p.officerId) &&
        inPeriod(t.createdAt, p),
    )
    const branchName = (id: string) => db().branches.find((b) => b.id === id)?.name ?? ''
    const groups = new Map<
      string,
      {
        branch: string
        channel: string
        type: string
        count: number
        credits: number
        debits: number
      }
    >()
    for (const t of txns) {
      const who =
        t.channel === 'field'
          ? (t.officerName ?? 'Field')
          : t.channel === 'counter'
            ? 'Counter'
            : 'System'
      const key = `${t.branchId}|${who}|${t.type}`
      const g = groups.get(key) ?? {
        branch: branchName(t.branchId),
        channel: who,
        type: TRANSACTION_TYPE_LABELS[t.type],
        count: 0,
        credits: 0,
        debits: 0,
      }
      g.count++
      if (t.direction === 'credit') g.credits += t.amount
      else g.debits += t.amount
      groups.set(key, g)
    }
    const rows = [...groups.values()]
      .sort(
        (a, b) =>
          a.branch.localeCompare(b.branch) ||
          a.channel.localeCompare(b.channel) ||
          a.type.localeCompare(b.type),
      )
      .map((g) => ({ ...g, credits: m(g.credits), debits: m(g.debits) }))
    return {
      columns: [
        col('branch', 'Branch'),
        col('channel', 'Officer or channel'),
        col('type', 'Type'),
        col('count', 'Count', 'number'),
        col('credits', 'Money in', 'money'),
        col('debits', 'Money out', 'money'),
      ],
      rows,
      totals: {
        branch: 'Total',
        count: sum(rows.map((r) => r.count)),
        credits: m(sum([...groups.values()].map((g) => g.credits))),
        debits: m(sum([...groups.values()].map((g) => g.debits))),
      },
    }
  },

  income: (p) => {
    // Headquarters holds no customers, so it has no line of its own.
    const branches = db().branches.filter(
      (b) => b.kind === 'branch' && (!p.branchId || b.id === p.branchId),
    )
    const all = branches.map((b) => ({
      branch: b.name,
      ...incomeFor({ branchId: b.id }, p.from, p.to),
    }))
    const rows = all.map((i) => ({
      branch: i.branch,
      interest: m(i.interest),
      fees: m(i.fees),
      penalties: m(i.penalties),
      commissions: m(i.commissions),
      charges: m(i.charges),
      total: m(i.total),
    }))
    const t = (k: 'interest' | 'fees' | 'penalties' | 'commissions' | 'charges' | 'total') =>
      m(sum(all.map((i) => i[k])))
    return {
      columns: [
        col('branch', 'Branch'),
        col('interest', 'Loan interest', 'money'),
        col('fees', 'Processing fees', 'money'),
        col('penalties', 'Penalties', 'money'),
        col('commissions', 'Thrift commissions', 'money'),
        col('charges', 'Withdrawal charges', 'money'),
        col('total', 'Total income', 'money'),
      ],
      rows,
      totals: {
        branch: 'Total',
        interest: t('interest'),
        fees: t('fees'),
        penalties: t('penalties'),
        commissions: t('commissions'),
        charges: t('charges'),
        total: t('total'),
      },
      notes: [
        'Interest is counted as repayments come in, in proportion to each loan’s interest share.',
      ],
    }
  },

  'loan-portfolio': (p) => {
    const loans = db()
      .loans.filter(
        (l) =>
          (!p.branchId || l.branchId === p.branchId) &&
          (!p.officerId || l.officerId === p.officerId),
      )
      .map(current)
    const rows = db().loanProducts.map((prod) => {
      const mine = loans.filter((l) => l.productId === prod.id)
      const active = mine.filter((l) => l.status === 'active')
      const balanced = active.filter((l) => l.arrears === 0)
      const unbalanced = active.filter((l) => l.arrears > 0)
      const disbursed = mine.filter((l) => inPeriod(l.disbursedAt, p))
      return {
        product: prod.name,
        disbursedCount: disbursed.length,
        disbursed: m(sum(disbursed.map((l) => l.principal))),
        activeCount: active.length,
        outstanding: m(sum(active.map((l) => l.outstanding))),
        balancedCount: balanced.length,
        balanced: m(sum(balanced.map((l) => l.outstanding))),
        unbalancedCount: unbalanced.length,
        unbalanced: m(sum(unbalanced.map((l) => l.outstanding))),
        arrears: m(sum(unbalanced.map((l) => l.arrears))),
      }
    })
    const n = (k: 'disbursedCount' | 'activeCount' | 'balancedCount' | 'unbalancedCount') =>
      sum(rows.map((r) => r[k]))
    const a = (k: 'disbursed' | 'outstanding' | 'balanced' | 'unbalanced' | 'arrears') =>
      m(sum(rows.map((r) => parseDecimal(String(r[k])))))
    return {
      columns: [
        col('product', 'Product'),
        col('disbursedCount', 'Disbursed in period', 'number'),
        col('disbursed', 'Amount disbursed', 'money'),
        col('activeCount', 'Active loans', 'number'),
        col('outstanding', 'Outstanding', 'money'),
        col('balancedCount', 'Balanced (up to date)', 'number'),
        col('balanced', 'Balanced amount', 'money'),
        col('unbalancedCount', 'Unbalanced (in arrears)', 'number'),
        col('unbalanced', 'Unbalanced amount', 'money'),
        col('arrears', 'Arrears', 'money'),
      ],
      rows,
      totals: {
        product: 'Total',
        disbursedCount: n('disbursedCount'),
        disbursed: a('disbursed'),
        activeCount: n('activeCount'),
        outstanding: a('outstanding'),
        balancedCount: n('balancedCount'),
        balanced: a('balanced'),
        unbalancedCount: n('unbalancedCount'),
        unbalanced: a('unbalanced'),
        arrears: a('arrears'),
      },
    }
  },

  'loan-summary': (p) => {
    const loans = db()
      .loans.filter(
        (l) =>
          (!p.branchId || l.branchId === p.branchId) &&
          (!p.officerId || l.officerId === p.officerId) &&
          inPeriod(l.disbursedAt, p),
      )
      .map(current)
      .sort((a, b) => (a.disbursedAt ?? '').localeCompare(b.disbursedAt ?? ''))
    const rows = loans.map((l) => ({
      loan: l.loanNumber,
      customer: l.customerName,
      product: l.productName,
      disbursed: l.disbursedAt!.slice(0, 10),
      principal: m(l.principal),
      interest: m(l.interest),
      total: m(l.totalRepayable),
      paid: m(l.amountPaid),
      outstanding: m(l.outstanding),
      arrears: m(l.arrears),
      status: l.status,
    }))
    const t = (
      k: 'principal' | 'interest' | 'totalRepayable' | 'amountPaid' | 'outstanding' | 'arrears',
    ) => m(sum(loans.map((l) => l[k])))
    return {
      columns: [
        col('loan', 'Loan'),
        col('customer', 'Customer'),
        col('product', 'Product'),
        col('disbursed', 'Disbursed', 'date'),
        col('principal', 'Principal', 'money'),
        col('interest', 'Interest', 'money'),
        col('total', 'Total repayable', 'money'),
        col('paid', 'Paid', 'money'),
        col('outstanding', 'Outstanding', 'money'),
        col('arrears', 'Arrears', 'money'),
        col('status', 'Status'),
      ],
      rows,
      totals: {
        loan: `${loans.length} loans`,
        principal: t('principal'),
        interest: t('interest'),
        total: t('totalRepayable'),
        paid: t('amountPaid'),
        outstanding: t('outstanding'),
        arrears: t('arrears'),
      },
    }
  },

  defaulters: (p) => {
    const loans = activeLoans(p)
      .filter((l) => l.daysInArrears >= p.minDays)
      .sort((a, b) => b.daysInArrears - a.daysInArrears)
    const rows = loans.map((l) => {
      const c = db().customers.find((x) => x.id === l.customerId)
      const officer = db().staff.find((s) => s.id === l.officerId)
      return {
        customer: l.customerName,
        phone: c?.phone ?? '',
        area: c?.area ?? '',
        officer: officer ? staffName(officer) : '',
        loan: l.loanNumber,
        days: l.daysInArrears,
        arrears: m(l.arrears),
        outstanding: m(l.outstanding),
        guarantor: l.guarantors[0] ? `${l.guarantors[0].fullName}, ${l.guarantors[0].phone}` : '',
      }
    })
    return {
      columns: [
        col('customer', 'Customer'),
        col('phone', 'Phone', 'phone'),
        col('area', 'Area'),
        col('officer', 'Officer'),
        col('loan', 'Loan'),
        col('days', 'Days late', 'number'),
        col('arrears', 'Arrears', 'money'),
        col('outstanding', 'Outstanding', 'money'),
        col('guarantor', 'First guarantor'),
      ],
      rows,
      totals: {
        customer: `${rows.length} borrowers`,
        arrears: m(sum(loans.map((l) => l.arrears))),
        outstanding: m(sum(loans.map((l) => l.outstanding))),
      },
    }
  },

  'loans-overdue': (p) => {
    const today = todayIso()
    const loans = activeLoans(p).filter((l) => l.maturityDate !== null && l.maturityDate < today)
    const rows = loans.map((l) => ({
      loan: l.loanNumber,
      customer: l.customerName,
      product: l.productName,
      maturity: l.maturityDate,
      daysPast: Math.round(
        (new Date(`${today}T12:00:00+01:00`).getTime() -
          new Date(`${l.maturityDate}T12:00:00+01:00`).getTime()) /
          86_400_000,
      ),
      outstanding: m(l.outstanding),
      penalty: m(l.penaltyAccrued),
    }))
    return {
      columns: [
        col('loan', 'Loan'),
        col('customer', 'Customer'),
        col('product', 'Product'),
        col('maturity', 'Final installment was due', 'date'),
        col('daysPast', 'Days past', 'number'),
        col('outstanding', 'Still owed', 'money'),
        col('penalty', 'Penalty not charged', 'money'),
      ],
      rows,
      totals: {
        loan: `${rows.length} loans`,
        outstanding: m(sum(loans.map((l) => l.outstanding))),
        penalty: m(sum(loans.map((l) => l.penaltyAccrued))),
      },
    }
  },

  'account-balances': (p) => {
    const accounts = db().accounts.filter((a) => !p.branchId || a.branchId === p.branchId)
    const rows: Row[] = []
    for (const type of ['savings', 'target', 'thrift', 'loan'] as const) {
      for (const status of ['active', 'dormant', 'frozen', 'closed'] as const) {
        const mine = accounts.filter((a) => a.type === type && a.status === status)
        if (mine.length === 0) continue
        rows.push({
          type: ACCOUNT_TYPE_LABELS[type],
          status,
          count: mine.length,
          balance: m(sum(mine.map((a) => a.balance))),
        })
      }
    }
    return {
      columns: [
        col('type', 'Account type'),
        col('status', 'Status'),
        col('count', 'Accounts', 'number'),
        col('balance', 'Total balance', 'money'),
      ],
      rows,
      totals: { type: 'Total', count: accounts.length },
      notes: ['For loan accounts, the balance is what customers still owe.'],
    }
  },

  'dormant-accounts': (p) => {
    const accounts = db().accounts.filter(
      (a) =>
        a.status === 'dormant' &&
        (!p.branchId || a.branchId === p.branchId) &&
        (!p.officerId || a.officerId === p.officerId),
    )
    const rows = accounts.map((a) => ({
      account: a.accountNumber,
      customer: a.customerName,
      type: ACCOUNT_TYPE_LABELS[a.type],
      lastActivity: a.lastTransactionAt?.slice(0, 10) ?? null,
      balance: m(a.balance),
    }))
    return {
      columns: [
        col('account', 'Account'),
        col('customer', 'Customer'),
        col('type', 'Type'),
        col('lastActivity', 'Last activity', 'date'),
        col('balance', 'Balance', 'money'),
      ],
      rows,
      totals: {
        account: `${rows.length} accounts`,
        balance: m(sum(accounts.map((a) => a.balance))),
      },
    }
  },

  'closed-accounts': (p) => {
    const accounts = db().accounts.filter(
      (a) =>
        a.status === 'closed' &&
        inPeriod(a.closedAt, p) &&
        (!p.branchId || a.branchId === p.branchId) &&
        (!p.officerId || a.officerId === p.officerId),
    )
    const rows = accounts.map((a) => ({
      account: a.accountNumber,
      customer: a.customerName,
      type: ACCOUNT_TYPE_LABELS[a.type],
      product: a.productName ?? '',
      opened: a.openedAt.slice(0, 10),
      closed: a.closedAt!.slice(0, 10),
    }))
    return {
      columns: [
        col('account', 'Account'),
        col('customer', 'Customer'),
        col('type', 'Type'),
        col('product', 'Plan or product'),
        col('opened', 'Opened', 'date'),
        col('closed', 'Closed', 'date'),
      ],
      rows,
      totals: { account: `${rows.length} accounts` },
    }
  },

  statement: (p) => {
    if (!p.accountNumber) throw new DomainError('Enter the account number.', 'account')
    const account = db().accounts.find(
      (a) => a.accountNumber === p.accountNumber && (!p.branchId || a.branchId === p.branchId),
    )
    if (!account)
      throw new DomainError('No account with this number in the branches you can see.', 'account')
    const all = db()
      .transactions.filter((t) => t.accountId === account.id)
      // Same-minute entries (a contribution and its commission) keep posting order.
      .sort(
        (a, b) => a.createdAt.localeCompare(b.createdAt) || a.reference.localeCompare(b.reference),
      )
    const before = all.filter((t) => lagosDay(t.createdAt) < p.from)
    const inside = all.filter((t) => inPeriod(t.createdAt, p))
    const opening: Kobo = before.length ? before[before.length - 1]!.balanceAfter : kobo(0)
    const closing: Kobo = inside.length ? inside[inside.length - 1]!.balanceAfter : opening
    const rows: Row[] = [
      {
        date: p.from,
        reference: '',
        description: 'Opening balance',
        debit: null,
        credit: null,
        balance: m(opening),
      },
      ...inside.map((t) => ({
        date: t.createdAt.slice(0, 10),
        reference: t.reference,
        description:
          TRANSACTION_TYPE_LABELS[t.type] +
          (t.status === 'reversed' ? ' (reversed)' : '') +
          (t.narration ? ` · ${t.narration}` : ''),
        debit: t.direction === 'debit' ? m(t.amount) : null,
        credit: t.direction === 'credit' ? m(t.amount) : null,
        balance: m(t.balanceAfter),
      })),
    ]
    return {
      columns: [
        col('date', 'Date', 'date'),
        col('reference', 'Reference'),
        col('description', 'Description'),
        col('debit', 'Debit', 'money'),
        col('credit', 'Credit', 'money'),
        col('balance', 'Balance', 'money'),
      ],
      rows,
      totals: {
        description: 'Closing balance',
        debit: m(sum(inside.filter((t) => t.direction === 'debit').map((t) => t.amount))),
        credit: m(sum(inside.filter((t) => t.direction === 'credit').map((t) => t.amount))),
        balance: m(closing),
      },
      notes: [
        `${account.customerName} · ${ACCOUNT_TYPE_LABELS[account.type]} account ${account.accountNumber}${account.productName ? ` · ${account.productName}` : ''}`,
      ],
    }
  },
}

export function runReport(key: string, params: ReportParams): ReportResult {
  const def = reportByKey(key)
  const build = builders[key]
  if (!def || !build) throw new DomainError('There is no such report.')
  const result = build(params)
  return {
    key,
    title: def.title,
    generatedAt: new Date().toISOString(),
    period: def.filters.includes('period') ? { from: params.from, to: params.to } : null,
    columns: result.columns,
    rows: result.rows,
    totals: result.totals ?? null,
    notes: result.notes ?? [],
  }
}
