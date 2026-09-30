import { toIsoDate } from '@/lib/dates'
import { formatNaira, kobo, naira, ZERO, type Kobo } from '@/lib/money'
import type {
  Account,
  Approval,
  AuditEntry,
  BusinessSettings,
  CounterPostingRequest,
  TransferRequest,
  Branch,
  Customer,
  CustomerStatus,
  Gender,
  LoanProduct,
  PaymentMethod,
  RepaymentFrequency,
  Role,
  Staff,
  StaffStatus,
  ThriftPlan,
  Transaction,
  TransactionType,
} from '@/types'
import {
  addDays,
  lagosTimestamp,
  nowMinutesInLagos,
  subtractWorkingDays,
  weekday,
  workingDaysBetween,
} from './calendar'
import { Random } from './random'
import {
  BRANCH_SEEDS,
  NAME_POOLS,
  OCCUPATIONS,
  PHONE_PREFIXES,
  RELATIONSHIPS,
  STREETS,
  type BranchSeed,
} from './reference'

import { buildSchedule, processingFee, type Calendar } from '@/lib/loans'
import { ROLE_PERMISSIONS } from '@/lib/permissions'
import { DEMO_PASSWORD } from '../demoLogins'
import { refreshLoan, type LoanRecord } from '../loanState'
import { defaultSettings, HOLIDAYS_2026 } from './settings'

export { DEMO_OTP, DEMO_PASSWORD } from '../demoLogins'

export interface StaffRecord extends Staff {
  password: string
  mustChangePassword: boolean
  /** When a temporary password stops working; null once they choose their own. */
  temporaryPasswordExpiresAt?: string | null
}

/** Stored remittance; expected figures are always recomputed from transactions. */
export interface RemittanceRecord {
  id: string
  date: string
  officerId: string
  branchId: string
  submittedAt: string
  /** Expected cash when the officer submitted, kept for the record. */
  submittedExpectedCash: Kobo
  cashReceived: Kobo | null
  confirmedById: string | null
  confirmedAt: string | null
  note: string
}

export interface ApprovalRecord extends Approval {
  /** What to do when approved. */
  payload: {
    thriftPlanId?: string | null
    posting?: CounterPostingRequest
    transfer?: TransferRequest
    extraInstallments?: number
  }
}

export interface MockDb {
  settings: BusinessSettings
  audit: AuditEntry[]
  remittances: RemittanceRecord[]
  approvals: ApprovalRecord[]
  branches: Branch[]
  staff: StaffRecord[]
  customers: Customer[]
  thriftPlans: ThriftPlan[]
  loanProducts: LoanProduct[]
  accounts: Account[]
  loans: LoanRecord[]
  transactions: Transaction[]
}

const HISTORY_DAYS = 60
const SEED_CALENDAR: Calendar = {
  workingDays: [1, 2, 3, 4, 5, 6],
  holidays: HOLIDAYS_2026.map((h) => h.date),
}
const LOAN_PURPOSES = [
  'Restock shop goods',
  'Buy a deep freezer for the business',
  'Pay for goods at wholesale price',
  'Expand the stall',
  'Buy a sewing machine',
  'Pay shop rent',
  'Working capital for the festive season',
] as const
const COLLATERAL = [
  'Shop goods and stock',
  'Deep freezer',
  'Generator',
  'Motorcycle papers',
  'Shop lease document',
] as const
const CUSTOMER_COUNT = 400
const PRODUCT_CODES = { savings: '10' } as const

type Behaviour = 'good' | 'late' | 'poor'
const PAY_RATE: Record<Behaviour, number> = { good: 0.96, late: 0.8, poor: 0.5 }

export function generateDb(now: Date = new Date(), seed = 20260925): MockDb {
  const rng = new Random(seed)
  const today = toIsoDate(now)
  const nowMinutes = nowMinutesInLagos(now)
  const windowStart = addDays(today, -HISTORY_DAYS)
  const collectionDays = workingDaysBetween(windowStart, today)

  // ── Helpers ────────────────────────────────────────────────────────────
  const pickName = (gender: Gender) => {
    const pool = rng.weighted(NAME_POOLS)
    return {
      first: rng.pick(gender === 'female' ? pool.female : pool.male),
      last: rng.pick(pool.surnames),
    }
  }
  const phone = () => rng.pick(PHONE_PREFIXES) + rng.digits(7)
  const pastTimestamp = (maxDaysAgo: number, minDaysAgo = 0) =>
    lagosTimestamp(addDays(today, -rng.int(minDaysAgo, maxDaysAgo)), rng.int(8 * 60, 17 * 60))
  /** Time of day for a collection; today's must be earlier than now. */
  const collectionTime = (iso: string): string | null => {
    if (iso === today) {
      if (nowMinutes < 8 * 60 + 15) return null
      const minute = rng.int(8 * 60, Math.min(nowMinutes - 5, 17 * 60 + 30))
      return lagosTimestamp(iso, minute)
    }
    return lagosTimestamp(iso, rng.int(8 * 60, 17 * 60 + 30))
  }

  // ── Branches ───────────────────────────────────────────────────────────
  const branches: Branch[] = BRANCH_SEEDS.map((b) => ({
    id: rng.uuid(),
    kind: 'branch' as const,
    code: b.code,
    name: b.name,
    address: b.address,
    phone: b.phone,
    areas: [...b.areas],
    managerId: null,
    managerName: null,
    status: 'active',
    staffCount: 0,
    customerCount: 0,
    createdAt: lagosTimestamp('2021-03-01', 9 * 60),
  }))
  const seedFor = new Map<string, BranchSeed>(branches.map((b, i) => [b.id, BRANCH_SEEDS[i]!]))

  // Headquarters oversees every branch. It has staff but no customers or areas.
  const hq: Branch = {
    id: rng.uuid(),
    kind: 'headquarters',
    code: '00',
    name: 'Headquarters',
    address: '12 Egbeda-Idimu Road, Egbeda, Lagos',
    phone: '08091234500',
    areas: [],
    managerId: null,
    managerName: null,
    status: 'active',
    staffCount: 0,
    customerCount: 0,
    createdAt: lagosTimestamp('2021-01-11', 9 * 60),
  }

  // ── Staff ──────────────────────────────────────────────────────────────
  const staff: StaffRecord[] = []
  const usedEmails = new Set<string>()
  let staffSerial = 1

  const addStaff = (
    role: Role,
    branch: Branch | null,
    options: {
      first?: string
      last?: string
      email?: string
      status?: StaffStatus
      mustChangePassword?: boolean
    } = {},
  ): StaffRecord => {
    const generated = pickName(rng.chance(0.5) ? 'female' : 'male')
    const first = options.first ?? generated.first
    const last = options.last ?? generated.last
    let email = options.email ?? `${first}.${last}@ems.ng`.toLowerCase()
    for (let n = 2; usedEmails.has(email); n++) email = `${first}.${last}${n}@ems.ng`.toLowerCase()
    usedEmails.add(email)
    const record: StaffRecord = {
      id: rng.uuid(),
      staffId: `EMS/${String(staffSerial++).padStart(4, '0')}`,
      firstName: first,
      lastName: last,
      email,
      phone: phone(),
      role,
      branchId: branch?.id ?? null,
      branchName: branch?.name ?? null,
      status: options.status ?? 'active',
      permissions: [...ROLE_PERMISSIONS[role]],
      lastLoginAt: options.mustChangePassword ? null : pastTimestamp(2),
      createdAt: pastTimestamp(1200, 60),
      password: DEMO_PASSWORD,
      mustChangePassword: options.mustChangePassword ?? false,
    }
    staff.push(record)
    return record
  }

  addStaff('md', hq, { first: 'Folasade', last: 'Adeyemi', email: 'md@ems.ng' })
  const gm = addStaff('general_manager', hq, {
    first: 'Adewale',
    last: 'Balogun',
    email: 'gm@ems.ng',
  })
  hq.managerId = gm.id
  hq.managerName = `${gm.firstName} ${gm.lastName}`
  addStaff('admin', hq, { first: 'Chinedu', last: 'Okafor', email: 'admin@ems.ng' })

  branches.forEach((branch, index) => {
    const isEgbeda = index === 0
    const manager = addStaff(
      'branch_manager',
      branch,
      isEgbeda ? { first: 'Babatunde', last: 'Ogunleye', email: 'manager@ems.ng' } : {},
    )
    branch.managerId = manager.id
    branch.managerName = `${manager.firstName} ${manager.lastName}`
    addStaff(
      'accountant',
      branch,
      isEgbeda ? { first: 'Ngozi', last: 'Eze', email: 'accountant@ems.ng' } : {},
    )
    if (branch.name === 'Ikotun') {
      addStaff('cashier', branch, {
        first: 'Zainab',
        last: 'Abdullahi',
        email: 'newstaff@ems.ng',
        mustChangePassword: true,
      })
    } else {
      addStaff(
        'cashier',
        branch,
        isEgbeda ? { first: 'Kafayat', last: 'Bakare', email: 'cashier@ems.ng' } : {},
      )
    }
    const officerCount = index % 2 === 0 ? 5 : 4
    for (let i = 0; i < officerCount; i++) {
      if (isEgbeda && i === 0) {
        addStaff('account_officer', branch, {
          first: 'Olumide',
          last: 'Salami',
          email: 'officer@ems.ng',
        })
      } else if (branch.name === 'Ipaja' && i === officerCount - 1) {
        addStaff('account_officer', branch, {
          first: 'Kelechi',
          last: 'Nwosu',
          email: 'suspended@ems.ng',
          status: 'suspended',
        })
      } else {
        addStaff('account_officer', branch)
      }
    }
  })

  // ── Products ───────────────────────────────────────────────────────────
  const plan = (
    code: string,
    name: string,
    frequency: ThriftPlan['frequency'],
    amount: number,
    cycleLength: number,
    commission: ThriftPlan['commission'],
    status: ThriftPlan['status'] = 'active',
  ): ThriftPlan => ({
    id: rng.uuid(),
    code,
    name,
    frequency,
    contributionAmount: naira(amount),
    cycleLength,
    commission,
    allowedMisses: frequency === 'daily' ? 3 : 1,
    earlyWithdrawalAllowed: frequency === 'weekly',
    status,
  })
  const thriftPlans = [
    plan('21', 'Daily ₦500', 'daily', 500, 31, { type: 'first_contribution' }),
    plan('22', 'Daily ₦1,000', 'daily', 1000, 31, { type: 'first_contribution' }),
    plan('23', 'Daily ₦2,000', 'daily', 2000, 31, { type: 'first_contribution' }),
    plan('24', 'Weekly ₦5,000', 'weekly', 5000, 13, { type: 'percentage', percent: '3.00' }),
    plan('25', 'Daily ₦200', 'daily', 200, 31, { type: 'first_contribution' }, 'retired'),
  ]
  const activePlans = thriftPlans.filter((p) => p.status === 'active')

  const product = (
    code: string,
    name: string,
    frequency: RepaymentFrequency,
    interestMethod: LoanProduct['interestMethod'],
    rate: string,
    tenors: readonly number[],
    min: number,
    max: number,
    fee: LoanProduct['processingFee'],
    penalty: LoanProduct['penalty'],
    extra: Partial<Pick<LoanProduct, 'kind' | 'interestBasis'>> = {},
  ): LoanProduct & { tenors: readonly number[] } => ({
    id: rng.uuid(),
    code,
    name,
    kind: extra.kind ?? 'cash',
    interestMethod,
    interestBasis: extra.interestBasis ?? 'monthly',
    ratePercent: rate,
    repaymentFrequency: frequency,
    minTenor: tenors[0] ?? 1,
    maxTenor: tenors[tenors.length - 1] ?? 1,
    minAmount: naira(min),
    maxAmount: naira(max),
    processingFee: fee,
    penalty,
    requiresGuarantor: true,
    status: 'active',
    tenors,
  })
  const loanProducts = [
    product(
      '31',
      'Daily market loan',
      'daily',
      'flat',
      '4.00',
      [30, 60, 90, 120],
      50_000,
      1_000_000,
      { type: 'percentage', percent: '2.00' },
      { type: 'percentage', percentPerDay: '0.50', graceDays: 2, capPercent: '20.00' },
    ),
    product(
      '32',
      'Weekly trader loan',
      'weekly',
      'flat',
      '3.50',
      [8, 12, 16, 24],
      100_000,
      3_000_000,
      { type: 'percentage', percent: '2.50' },
      { type: 'percentage', percentPerDay: '1.00', graceDays: 3, capPercent: '25.00' },
    ),
    product(
      '33',
      'Monthly SME loan',
      'monthly',
      'reducing_balance',
      '3.00',
      [3, 6, 9, 12],
      500_000,
      10_000_000,
      { type: 'percentage', percent: '3.00' },
      { type: 'percentage', percentPerDay: '1.00', graceDays: 5, capPercent: '30.00' },
    ),
    // Buy now pay later: the company buys the item, the customer repays weekly.
    // Demonstrates an overall rate, a flat fee and a flat daily penalty.
    product(
      '34',
      'Buy now pay later (weekly)',
      'weekly',
      'flat',
      '15.00',
      [8, 12, 16],
      50_000,
      1_500_000,
      { type: 'flat', amount: naira(2_000) },
      { type: 'flat', amountPerDay: naira(200), graceDays: 3, capPercent: '20.00' },
      { kind: 'bnpl', interestBasis: 'overall' },
    ),
  ]

  // ── Customers ──────────────────────────────────────────────────────────
  const customers: Customer[] = []
  const officersByBranch = new Map<string, StaffRecord[]>(
    branches.map((b) => [
      b.id,
      staff.filter((s) => s.branchId === b.id && s.role === 'account_officer'),
    ]),
  )
  const cashierByBranch = new Map<string, StaffRecord>(
    branches.map((b) => [b.id, staff.find((s) => s.branchId === b.id && s.role === 'cashier')!]),
  )

  for (let i = 0; i < CUSTOMER_COUNT; i++) {
    const branch = branches[i % branches.length]!
    const bSeed = seedFor.get(branch.id)!
    const officers = officersByBranch.get(branch.id)!
    const officer = officers[Math.floor(i / branches.length) % officers.length]!
    const gender: Gender = rng.chance(0.62) ? 'female' : 'male'
    const name = pickName(gender)
    const area = rng.pick(bSeed.areas)
    const status = rng.weighted<CustomerStatus>([
      ['active', 91],
      ['pending_approval', 4],
      ['inactive', 4],
      ['blacklisted', 1],
    ])
    const kin = pickName(rng.chance(0.5) ? 'female' : 'male')
    customers.push({
      id: rng.uuid(),
      customerNumber: `C${branch.code}${String(i + 1).padStart(5, '0')}`,
      firstName: name.first,
      lastName: name.last,
      otherNames: rng.chance(0.4) ? pickName(gender).first : '',
      gender,
      dateOfBirth: `${rng.int(1965, 2002)}-${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`,
      phone: phone(),
      altPhone: rng.chance(0.3) ? phone() : null,
      email: rng.chance(0.2)
        ? `${name.first}.${name.last}${rng.int(1, 99)}@gmail.com`.toLowerCase()
        : null,
      bvn: rng.chance(0.85) ? '22' + rng.digits(9) : null,
      address: `${rng.int(1, 120)} ${rng.pick(STREETS)}, ${area}`,
      area,
      occupation: rng.pick(OCCUPATIONS),
      branchId: branch.id,
      branchName: branch.name,
      officerId: officer.id,
      officerName: `${officer.firstName} ${officer.lastName}`,
      status,
      photoUrl: null,
      signatureUrl: null,
      nextOfKin: {
        fullName: `${kin.first} ${name.last}`,
        relationship: rng.pick(RELATIONSHIPS),
        phone: phone(),
        address: `${rng.int(1, 120)} ${rng.pick(STREETS)}, ${rng.pick(bSeed.areas)}`,
      },
      guarantors: [],
      createdAt: status === 'pending_approval' ? pastTimestamp(3) : pastTimestamp(1000, 70),
    })
  }

  const managerOfBranch = new Map(
    branches.map((b) => [
      b.id,
      staff.find((s) => s.branchId === b.id && s.role === 'branch_manager')!,
    ]),
  )
  const MD_NAME = 'Folasade Adeyemi'

  // ── Accounts, loans and transaction history ─────────────────────────────
  const accounts: Account[] = []
  const loans: LoanRecord[] = []
  const transactions: Omit<Transaction, 'reference'>[] = []
  let accountSerial = 1
  let loanSerial = 1

  const accountNumber = (branch: Branch, productCode: string) =>
    `${branch.code}${productCode}${String(accountSerial++).padStart(6, '0')}`

  const officerById = new Map(staff.map((s) => [s.id, s]))

  for (const customer of customers) {
    if (customer.status === 'pending_approval') continue
    const branch = branches.find((b) => b.id === customer.branchId)!
    const bSeed = seedFor.get(branch.id)!
    const officer = officerById.get(customer.officerId)!
    const cashier = cashierByBranch.get(branch.id)!
    const customerName = `${customer.firstName} ${customer.lastName}`
    const behaviour = rng.weighted<Behaviour>([
      ['good', 70],
      ['late', 20],
      ['poor', 10],
    ])
    const active = customer.status === 'active'
    const location = () => ({
      lat: Number((bSeed.centre.lat + (rng.next() - 0.5) * 0.02).toFixed(6)),
      lng: Number((bSeed.centre.lng + (rng.next() - 0.5) * 0.02).toFixed(6)),
      accuracyM: rng.int(5, 40),
    })

    const openAccount = (
      type: Account['type'],
      code: string,
      productId: string | null,
      productName: string | null,
      openedAt: string,
    ): Account => {
      const account: Account = {
        id: rng.uuid(),
        accountNumber: accountNumber(branch, code),
        type,
        customerId: customer.id,
        customerName,
        branchId: branch.id,
        officerId: officer.id,
        productId,
        productName,
        status: 'active',
        balance: ZERO,
        openedAt,
        closedAt: null,
        lastTransactionAt: null,
        target: null,
      }
      accounts.push(account)
      return account
    }

    const record = (
      account: Account,
      type: TransactionType,
      direction: 'credit' | 'debit',
      amount: Kobo,
      balanceAfter: Kobo,
      createdAt: string,
      channel: Transaction['channel'],
      paymentMethod: PaymentMethod | null = null,
    ) => {
      const field = channel === 'field'
      transactions.push({
        id: rng.uuid(),
        type,
        direction,
        amount,
        balanceAfter,
        accountId: account.id,
        accountNumber: account.accountNumber,
        customerId: customer.id,
        customerName,
        branchId: branch.id,
        officerId: field ? officer.id : null,
        officerName: field ? `${officer.firstName} ${officer.lastName}` : null,
        postedById: field ? officer.id : channel === 'counter' ? cashier.id : cashier.id,
        channel,
        paymentMethod,
        status: 'posted',
        location: field ? location() : null,
        idempotencyKey: field ? rng.uuid() : null,
        narration: null,
        createdAt,
      })
      account.lastTransactionAt = createdAt
    }
    const fieldMethod = (): PaymentMethod => (rng.chance(0.85) ? 'cash' : 'transfer')

    // Savings
    if (rng.chance(active ? 0.55 : 0.8)) {
      const account = openAccount('savings', PRODUCT_CODES.savings, null, null, customer.createdAt)
      let balance = naira(rng.int(20, 3000) * 100)
      const dormant = !active || rng.chance(0.08)
      if (dormant) {
        account.status = 'dormant'
        account.lastTransactionAt = pastTimestamp(500, 190)
      } else {
        const txnCount = rng.int(0, 4)
        // Sort by full timestamp so running balances follow posting order.
        const times = Array.from({ length: txnCount }, () =>
          collectionTime(rng.pick(collectionDays)),
        )
          .filter((t): t is string => t !== null)
          .sort()
        for (const at of times) {
          const withdraw = rng.chance(0.35) && balance > naira(5000)
          const amount = withdraw
            ? naira(
                Math.min(Math.floor(balance / 100 / 2 / 1000) * 1000, rng.int(2, 50) * 1000) ||
                  1000,
              )
            : naira(rng.int(1, 60) * 1000)
          balance = kobo(balance + (withdraw ? -amount : amount))
          record(
            account,
            withdraw ? 'withdrawal' : 'deposit',
            withdraw ? 'debit' : 'credit',
            amount,
            balance,
            at,
            'counter',
            'cash',
          )
        }
        if (!account.lastTransactionAt) account.lastTransactionAt = pastTimestamp(120, 61)
      }
      account.balance = balance
    }

    if (!active) continue

    // Thrift
    if (rng.chance(0.7)) {
      const thriftPlan = rng.weighted(
        activePlans.map((p, i) => [p, [30, 35, 20, 15][i] ?? 10] as const),
      )
      const account = openAccount(
        'thrift',
        thriftPlan.code,
        thriftPlan.id,
        thriftPlan.name,
        pastTimestamp(700, 61),
      )
      const amount = thriftPlan.contributionAmount
      const commissionFor = (contribution: Kobo): Kobo =>
        thriftPlan.commission.type === 'percentage'
          ? kobo(Math.round((contribution * Number(thriftPlan.commission.percent)) / 100))
          : ZERO
      let progress = rng.int(0, thriftPlan.cycleLength - 1)
      let balance = kobo(
        Math.max(0, progress - (thriftPlan.commission.type === 'first_contribution' ? 1 : 0)) *
          amount,
      )
      // Weekly savers pay on the weekday they joined (Monday if they joined on a Sunday).
      const payDay = weekday(account.openedAt.slice(0, 10)) || 1
      const days =
        thriftPlan.frequency === 'daily'
          ? collectionDays
          : collectionDays.filter((d) => weekday(d) === payDay)
      for (const day of days) {
        if (!rng.chance(PAY_RATE[behaviour])) continue
        const at = collectionTime(day)
        if (!at) continue
        balance = kobo(balance + amount)
        record(
          account,
          'thrift_contribution',
          'credit',
          amount,
          balance,
          at,
          'field',
          fieldMethod(),
        )
        const commission =
          progress === 0 && thriftPlan.commission.type === 'first_contribution'
            ? amount
            : commissionFor(amount)
        if (commission > 0) {
          balance = kobo(balance - commission)
          record(account, 'thrift_commission', 'debit', commission, balance, at, 'system')
        }
        progress++
        if (progress >= thriftPlan.cycleLength && day !== today) {
          record(
            account,
            'thrift_payout',
            'debit',
            balance,
            ZERO,
            lagosTimestamp(day, 16 * 60 + rng.int(0, 50)),
            'counter',
            rng.chance(0.6) ? 'transfer' : 'cash',
          )
          balance = ZERO
          progress = 0
        }
      }
      account.balance = balance
    }

    // Loan
    if (rng.chance(0.5)) {
      const loanProduct = rng.weighted([
        [loanProducts[0]!, 55],
        [loanProducts[1]!, 30],
        [loanProducts[2]!, 15],
      ] as const)
      const count = rng.pick(loanProduct.tenors)
      const minN = loanProduct.minAmount / 100 / 10_000
      const maxN = loanProduct.maxAmount / 100 / 10_000
      // Skew towards smaller loans.
      const principal = naira(Math.round(minN + (maxN - minN) * rng.next() ** 2.5) * 10_000)

      // About one in ten loans has run its full term and been repaid in full.
      const fullyRepaid = rng.chance(0.1)
      const maxElapsed = behaviour === 'poor' ? count + 4 : behaviour === 'late' ? count : count - 1
      const elapsed = fullyRepaid ? count + rng.int(0, 3) : rng.int(1, Math.max(1, maxElapsed))
      const payRate = fullyRepaid ? 1 : PAY_RATE[behaviour]
      const freq = loanProduct.repaymentFrequency
      const disbursedOn =
        freq === 'daily'
          ? subtractWorkingDays(today, elapsed)
          : addDays(
              today,
              -((freq === 'weekly' ? 7 : 30) * elapsed + rng.int(0, freq === 'weekly' ? 6 : 27)),
            )
      const quote = buildSchedule(
        {
          principal,
          ratePercent: loanProduct.ratePercent,
          interestBasis: loanProduct.interestBasis,
          interestMethod: loanProduct.interestMethod,
          frequency: freq,
          installmentCount: count,
        },
        disbursedOn,
        SEED_CALENDAR,
      )
      const total = quote.totalRepayable
      const fee = processingFee(principal, loanProduct.processingFee)

      // Borrowers name one or two guarantors.
      for (let g = rng.int(1, 2); g > 0; g--) {
        const guarantor = pickName(rng.chance(0.5) ? 'female' : 'male')
        customer.guarantors.push({
          id: rng.uuid(),
          photoUrl: null,
          signatureUrl: null,
          fullName: `${guarantor.first} ${guarantor.last}`,
          phone: phone(),
          address: `${rng.int(1, 120)} ${rng.pick(STREETS)}, ${rng.pick(bSeed.areas)}`,
          relationship: rng.pick([
            'Neighbour',
            'Trader in same market',
            'Relative',
            'Church member',
            'Friend',
          ]),
          occupation: rng.pick(OCCUPATIONS),
          bvn: rng.chance(0.6) ? '22' + rng.digits(9) : null,
        })
      }
      const account = openAccount(
        'loan',
        loanProduct.code,
        loanProduct.id,
        loanProduct.name,
        lagosTimestamp(disbursedOn, 10 * 60),
      )
      let paid = ZERO
      let outstanding = total
      if (disbursedOn >= windowStart) {
        record(
          account,
          'disbursement',
          'debit',
          principal,
          total,
          lagosTimestamp(disbursedOn, 10 * 60),
          'counter',
          'transfer',
        )
        record(
          account,
          'processing_fee',
          'debit',
          fee,
          total,
          lagosTimestamp(disbursedOn, 10 * 60),
          'system',
        )
      }
      for (const row of quote.rows) {
        if (row.dueDate > today) break
        if (outstanding <= 0 || !rng.chance(payRate)) continue
        const amount = kobo(Math.min(row.amount, outstanding))
        paid = kobo(paid + amount)
        outstanding = kobo(outstanding - amount)
        if (row.dueDate >= windowStart) {
          const at = collectionTime(row.dueDate)
          if (at)
            record(
              account,
              'loan_repayment',
              'credit',
              amount,
              outstanding,
              at,
              'field',
              fieldMethod(),
            )
        }
      }

      const closed = outstanding === 0
      account.balance = outstanding
      if (closed) {
        account.status = 'closed'
        account.closedAt = account.lastTransactionAt
      }
      const manager = managerOfBranch.get(branch.id)!
      const cashier = cashierByBranch.get(branch.id)!
      const loan: LoanRecord = {
        id: rng.uuid(),
        loanNumber: `LN${branch.code}${String(loanSerial++).padStart(6, '0')}`,
        accountId: account.id,
        accountNumber: account.accountNumber,
        customerId: customer.id,
        customerName,
        productId: loanProduct.id,
        productName: loanProduct.name,
        branchId: branch.id,
        officerId: officer.id,
        principal,
        interest: quote.interest,
        totalRepayable: total,
        amountPaid: paid,
        outstanding,
        arrears: ZERO,
        penaltyAccrued: ZERO,
        daysInArrears: 0,
        frequency: freq,
        installmentAmount: quote.installment,
        installmentCount: count,
        kind: loanProduct.kind,
        interestMethod: loanProduct.interestMethod,
        interestBasis: loanProduct.interestBasis,
        ratePercent: loanProduct.ratePercent,
        itemDescription: null,
        supplierName: null,
        processingFee: fee,
        penaltiesCharged: ZERO,
        status: closed ? 'closed' : 'active',
        purpose: rng.pick(LOAN_PURPOSES),
        guarantors: [...customer.guarantors],
        collateral:
          freq === 'monthly' || rng.chance(0.3)
            ? [
                {
                  description: rng.pick(COLLATERAL),
                  estimatedValue: naira(Math.round(((principal / 100) * 1.5) / 10_000) * 10_000),
                  documentRef: `REF-${rng.digits(6)}`,
                },
              ]
            : [],
        topUpOfId: null,
        topUpOfNumber: null,
        extensions: 0,
        nextDueDate: null,
        nextDueAmount: null,
        appliedByName: `${manager.firstName} ${manager.lastName}`,
        approvedByName: MD_NAME,
        disbursedByName: `${cashier.firstName} ${cashier.lastName}`,
        disbursedAt: lagosTimestamp(disbursedOn, 10 * 60),
        maturityDate: quote.maturityDate,
        closedAt: closed ? account.lastTransactionAt : null,
        createdAt: lagosTimestamp(addDays(disbursedOn, -rng.int(2, 7)), 11 * 60),
        schedule: quote.rows,
      }
      loans.push(refreshLoan(loan, loanProduct, today))
    }
  }

  // References are assigned in time order, numbered per day.
  transactions.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const perDay = new Map<string, number>()
  const referenced: Transaction[] = transactions.map((t) => {
    const day = t.createdAt.slice(0, 10)
    const seq = (perDay.get(day) ?? 0) + 1
    perDay.set(day, seq)
    return {
      ...t,
      reference: `EMS${day.slice(2).replaceAll('-', '')}${String(seq).padStart(5, '0')}`,
    }
  })
  referenced.reverse()

  // ── Remittances: last 7 working days confirmed; about half of today's submitted.
  const remittances: RemittanceRecord[] = []
  const accountantByBranch = new Map(
    branches.map((b) => [b.id, staff.find((s) => s.branchId === b.id && s.role === 'accountant')!]),
  )
  const remitDays = [...collectionDays].reverse().slice(0, 8)
  for (const day of remitDays) {
    const isToday = day === today
    for (const officer of staff.filter((s) => s.role === 'account_officer')) {
      const collected = referenced.filter(
        (t) =>
          t.officerId === officer.id &&
          t.channel === 'field' &&
          t.createdAt.startsWith(day) &&
          (t.type === 'thrift_contribution' || t.type === 'loan_repayment'),
      )
      if (collected.length === 0) continue
      if (isToday && (officer.email === 'officer@ems.ng' || !rng.chance(0.5))) continue
      const cash = kobo(
        collected.filter((t) => t.paymentMethod === 'cash').reduce((n, t) => n + t.amount, 0),
      )
      const short = !isToday && rng.chance(0.06) ? naira(rng.int(1, 10) * 500) : ZERO
      remittances.push({
        id: rng.uuid(),
        date: day,
        officerId: officer.id,
        branchId: officer.branchId!,
        submittedAt: lagosTimestamp(
          day,
          isToday ? Math.min(nowMinutes, 17 * 60 + rng.int(0, 45)) : 17 * 60 + rng.int(0, 45),
        ),
        submittedExpectedCash: cash,
        cashReceived: isToday ? null : kobo(cash - short),
        confirmedById: isToday ? null : accountantByBranch.get(officer.branchId!)!.id,
        confirmedAt: isToday ? null : lagosTimestamp(day, 18 * 60 + rng.int(0, 50)),
        note: short > 0 ? 'Officer to repay the shortfall from salary.' : '',
      })
    }
  }

  // ── Approvals ──────────────────────────────────────────────────────────
  const approvals: ApprovalRecord[] = []
  const staffName = (s: StaffRecord) => `${s.firstName} ${s.lastName}`
  const managerOf = (branchId: string) =>
    staff.find((s) => s.branchId === branchId && s.role === 'branch_manager')!
  const baseApproval = (branchId: string) => ({
    id: rng.uuid(),
    branchId,
    branchName: branches.find((b) => b.id === branchId)!.name,
    decidedByName: null,
    decidedAt: null,
    decisionNote: '',
    customerId: null,
    customerName: null,
    accountId: null,
    transactionId: null,
    loanId: null,
    amount: null,
    status: 'pending' as const,
  })

  for (const c of customers.filter((c) => c.status === 'pending_approval')) {
    const officer = officerById.get(c.officerId)!
    approvals.push({
      ...baseApproval(c.branchId),
      type: 'customer_registration',
      subject: `New thrift customer ${c.firstName} ${c.lastName}, ${c.area}`,
      customerId: c.id,
      customerName: `${c.firstName} ${c.lastName}`,
      requestedById: officer.id,
      requestedByName: staffName(officer),
      requestedAt: c.createdAt,
      reason: 'Registered in the field.',
      payload: { thriftPlanId: rng.pick(activePlans).id },
    })
  }

  const REVERSAL_REASONS = [
    'Collection recorded twice for the same customer.',
    'Recorded on the wrong account. Customer has two accounts.',
    'Customer paid by transfer but it was recorded as cash, and the transfer never arrived.',
  ]
  const recentField = referenced.filter(
    (t) =>
      t.channel === 'field' &&
      t.type === 'thrift_contribution' &&
      t.createdAt.slice(0, 10) >= addDays(today, -3) &&
      t.createdAt.slice(0, 10) < today,
  )
  for (const branch of branches.slice(0, 3)) {
    const candidates = recentField.filter((t) => t.branchId === branch.id)
    const count = branch.code === '01' ? 2 : 1
    for (let i = 0; i < count && candidates.length > 0; i++) {
      const txn = candidates.splice(rng.int(0, candidates.length - 1), 1)[0]!
      txn.status = 'pending_reversal'
      const accountant = accountantByBranch.get(branch.id)!
      approvals.push({
        ...baseApproval(branch.id),
        type: 'transaction_reversal',
        subject: `Reverse ${txn.reference}: thrift from ${txn.customerName}`,
        amount: txn.amount,
        customerId: txn.customerId,
        customerName: txn.customerName,
        accountId: txn.accountId,
        transactionId: txn.id,
        requestedById: accountant.id,
        requestedByName: staffName(accountant),
        requestedAt: pastTimestamp(1),
        reason: rng.pick(REVERSAL_REASONS),
        payload: {},
      })
    }
  }

  // Empty thrift accounts whose owners asked to close them.
  const emptyThrift = accounts.filter(
    (a) => a.type === 'thrift' && a.balance === 0 && a.status === 'active',
  )
  for (const account of emptyThrift.slice(0, 2)) {
    const cashier = cashierByBranch.get(account.branchId)!
    approvals.push({
      ...baseApproval(account.branchId),
      type: 'account_closure',
      subject: `Close thrift account ${account.accountNumber} for ${account.customerName}`,
      customerId: account.customerId,
      customerName: account.customerName,
      accountId: account.id,
      requestedById: cashier.id,
      requestedByName: staffName(cashier),
      requestedAt: pastTimestamp(1),
      reason: 'Customer has completed the cycle and does not want to continue.',
      payload: {},
    })
  }

  // A little decided history.
  for (const branch of branches.slice(0, 2)) {
    const manager = managerOf(branch.id)
    const cashier = cashierByBranch.get(branch.id)!
    approvals.push({
      ...baseApproval(branch.id),
      type: 'large_withdrawal',
      status: 'approved',
      subject: `Withdraw ₦650,000.00 from savings in ${branch.name}`,
      amount: naira(650_000),
      requestedById: cashier.id,
      requestedByName: staffName(cashier),
      requestedAt: pastTimestamp(9, 5),
      reason: 'Customer is paying for a shop.',
      decidedByName: staffName(manager),
      decidedAt: pastTimestamp(4, 4),
      decisionNote: 'Confirmed with the customer by phone.',
      payload: {},
    })
  }

  // Loan applications waiting for approval, and approved loans waiting to be paid out.
  for (const branch of branches) {
    const manager = managerOfBranch.get(branch.id)!
    const candidates = customers.filter(
      (c) =>
        c.branchId === branch.id &&
        c.status === 'active' &&
        c.bvn &&
        !loans.some((l) => l.customerId === c.id && l.status === 'active'),
    )
    for (let i = 0; i < 3 && candidates.length > 0; i++) {
      const customer = candidates.splice(rng.int(0, candidates.length - 1), 1)[0]!
      const loanProduct = rng.pick(loanProducts.slice(0, 2))
      const count = loanProduct.tenors[1]!
      const principal = naira(rng.int(10, 40) * 10_000)
      const quote = buildSchedule(
        {
          principal,
          ratePercent: loanProduct.ratePercent,
          interestBasis: loanProduct.interestBasis,
          interestMethod: loanProduct.interestMethod,
          frequency: loanProduct.repaymentFrequency,
          installmentCount: count,
        },
        today,
        SEED_CALENDAR,
      )
      const approved = i === 2
      const requestedAt = pastTimestamp(approved ? 3 : 2, approved ? 2 : 0)
      const loan: LoanRecord = {
        id: rng.uuid(),
        loanNumber: `LN${branch.code}${String(loanSerial++).padStart(6, '0')}`,
        accountId: null,
        accountNumber: null,
        customerId: customer.id,
        customerName: `${customer.firstName} ${customer.lastName}`,
        productId: loanProduct.id,
        productName: loanProduct.name,
        branchId: branch.id,
        officerId: customer.officerId,
        principal,
        interest: quote.interest,
        totalRepayable: quote.totalRepayable,
        amountPaid: ZERO,
        outstanding: ZERO,
        arrears: ZERO,
        penaltyAccrued: ZERO,
        daysInArrears: 0,
        frequency: loanProduct.repaymentFrequency,
        installmentAmount: quote.installment,
        installmentCount: count,
        kind: loanProduct.kind,
        interestMethod: loanProduct.interestMethod,
        interestBasis: loanProduct.interestBasis,
        ratePercent: loanProduct.ratePercent,
        itemDescription: null,
        supplierName: null,
        processingFee: processingFee(principal, loanProduct.processingFee),
        penaltiesCharged: ZERO,
        status: approved ? 'approved' : 'pending_approval',
        purpose: rng.pick(LOAN_PURPOSES),
        guarantors: customer.guarantors.length
          ? [...customer.guarantors]
          : [
              {
                id: rng.uuid(),
                photoUrl: null,
                signatureUrl: null,
                fullName: 'Rasheed Balogun',
                phone: phone(),
                address: `12 Market Road, ${customer.area}`,
                relationship: 'Trader in same market',
                occupation: 'Provision store owner',
                bvn: null,
              },
            ],
        collateral: [],
        topUpOfId: null,
        topUpOfNumber: null,
        extensions: 0,
        nextDueDate: null,
        nextDueAmount: null,
        appliedByName: staffName(manager),
        approvedByName: approved ? MD_NAME : null,
        disbursedByName: null,
        disbursedAt: null,
        maturityDate: null,
        closedAt: null,
        createdAt: requestedAt,
        schedule: quote.rows,
      }
      customer.guarantors = loan.guarantors
      loans.push(refreshLoan(loan, loanProduct, today))
      approvals.push({
        ...baseApproval(branch.id),
        type: 'loan_application',
        status: approved ? 'approved' : 'pending',
        subject: `Loan of ${formatNaira(principal, { trimZeroKobo: true })} for ${loan.customerName} (${loanProduct.name})`,
        amount: principal,
        customerId: customer.id,
        customerName: loan.customerName,
        loanId: loan.id,
        requestedById: manager.id,
        requestedByName: staffName(manager),
        requestedAt,
        reason: loan.purpose,
        decidedByName: approved ? MD_NAME : null,
        decidedAt: approved ? pastTimestamp(1, 1) : null,
        decisionNote: approved ? 'Guarantor confirmed by phone.' : '',
        payload: {},
      })
    }
  }

  const settings = defaultSettings(lagosTimestamp('2026-01-05', 9 * 60))

  // Audit history: sign-ins over the last two weeks, plus the approvals and sign-offs above.
  const audit: AuditEntry[] = []
  const ipFor = (s: StaffRecord) =>
    s.role === 'account_officer'
      ? `102.89.${rng.int(1, 60)}.${rng.int(2, 250)}`
      : s.branchId
        ? `10.0.${Number([hq, ...branches].find((b) => b.id === s.branchId)!.code)}.${rng.int(10, 60)}`
        : '10.0.0.12'
  const agentFor = (s: StaffRecord) =>
    s.role === 'account_officer' ? 'EMS Field on Android (Chrome 128)' : 'Chrome 128 on Windows'
  const logEntry = (
    s: StaffRecord,
    at: string,
    action: string,
    entityType: string,
    entityId: string | null,
    summary: string,
  ) =>
    audit.push({
      id: rng.uuid(),
      at,
      actorId: s.id,
      actorName: staffName(s),
      actorRole: s.role,
      action,
      entityType,
      entityId,
      summary,
      branchId: s.branchId,
      ipAddress: ipFor(s),
      userAgent: agentFor(s),
    })
  for (const day of [...collectionDays].reverse().slice(0, 12)) {
    for (const s of staff.filter((x) => x.status === 'active')) {
      if (!rng.chance(0.85)) continue
      const minute = rng.int(7 * 60 + 30, 9 * 60)
      if (day === today && minute > nowMinutes) continue
      logEntry(
        s,
        lagosTimestamp(day, minute),
        'auth.login',
        'session',
        null,
        'Signed in with password and SMS code',
      )
    }
  }
  for (const a of approvals) {
    const requester = staff.find((x) => x.id === a.requestedById)
    if (requester)
      logEntry(requester, a.requestedAt, `approval.request.${a.type}`, 'approval', a.id, a.subject)
  }
  for (const r of remittances.filter((x) => x.confirmedById)) {
    const accountant = staff.find((x) => x.id === r.confirmedById)!
    const officer = staff.find((x) => x.id === r.officerId)!
    logEntry(
      accountant,
      r.confirmedAt!,
      'remittance.confirm',
      'remittance',
      r.id,
      `Confirmed ${formatNaira(r.cashReceived!)} from ${staffName(officer)} for ${r.date}`,
    )
  }
  audit.sort((a, b) => b.at.localeCompare(a.at))

  for (const branch of [hq, ...branches]) {
    branch.staffCount = staff.filter((s) => s.branchId === branch.id).length
    branch.customerCount = customers.filter((c) => c.branchId === branch.id).length
  }

  return {
    settings,
    audit,
    remittances,
    approvals,
    branches: [hq, ...branches],
    staff,
    customers,
    thriftPlans,
    loanProducts: loanProducts.map(({ tenors: _tenors, ...rest }) => rest),
    accounts,
    loans,
    transactions: referenced,
  }
}
