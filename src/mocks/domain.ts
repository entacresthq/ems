import { todayIso, toIsoDate, toLagosIso } from '@/lib/dates'
import {
  DEFAULT_ACCOUNT_NUMBER_FORMAT,
  formatAccountNumber,
  nextSerial,
} from '@/lib/accountNumber'
import { buildSchedule, isOpen, respread, weekday, type Calendar } from '@/lib/loans'
import { formatNaira, kobo, ZERO, type Kobo } from '@/lib/money'
import type {
  Account,
  Approval,
  AuditEntry,
  Due,
  GeoPoint,
  LoanProduct,
  PaymentMethod,
  Remittance,
  SavingsTarget,
  SmsTemplateKey,
  TodayItem,
  Transaction,
  TransactionChannel,
  TransactionType,
} from '@/types'
import { approvesOwnRequests, ROLE_LABELS } from '@/types'
import { commit, db } from './db'
import { platform } from './platform'
import { calendarOf, refreshLoan, type LoanRecord } from './loanState'
import type { ApprovalRecord, StaffRecord } from './seed/generate'

export const staffName = (s: Pick<StaffRecord, 'firstName' | 'lastName'>) =>
  `${s.firstName} ${s.lastName}`

export function newId(): string {
  return crypto.randomUUID()
}

export const lagosDay = (iso: string) => toIsoDate(iso)

export class DomainError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message)
  }
}

// ── Settings ──────────────────────────────────────────────────────────────

export const settings = () => db().settings
export const calendar = (): Calendar => calendarOf(db().settings)
export const largeWithdrawalThreshold = () => db().settings.largeWithdrawalThreshold

// ── SMS ───────────────────────────────────────────────────────────────────

/** Fill in an SMS template from Settings and send it, if the template is switched on. */
export function sendTemplateSms(
  to: string,
  key: SmsTemplateKey,
  values: Record<string, string>,
): void {
  const template = db().settings.smsTemplates.find((t) => t.key === key)
  if (!template?.enabled || !to) return
  const message = template.body.replace(
    /{([a-z_]+)}/g,
    (match, name: string) => values[name] ?? match,
  )
  platform().sendSms(to, message)
}

// ── Audit log ─────────────────────────────────────────────────────────────

/** Where a request came from. The real backend records the client IP and user agent. */
function origin(actor: StaffRecord) {
  // The desktop server runs on this computer; every window reaches it locally.
  if (platform().live)
    return {
      ip: '127.0.0.1',
      agent: actor.role === 'account_officer' ? 'EMS Field (desktop)' : 'EMS desktop',
    }
  if (actor.role === 'account_officer')
    return { ip: '102.89.34.117', agent: 'EMS Field on Android' }
  const code = db().branches.find((b) => b.id === actor.branchId)?.code
  return { ip: code ? `10.0.${Number(code)}.24` : '10.0.0.12', agent: 'Chrome on Windows' }
}

export function audit(
  actor: StaffRecord,
  action: string,
  entityType: string,
  entityId: string | null,
  summary: string,
) {
  const { ip, agent } = origin(actor)
  const entry: AuditEntry = {
    id: newId(),
    at: toLagosIso(),
    actorId: actor.id,
    actorName: staffName(actor),
    actorRole: actor.role,
    action,
    entityType,
    entityId,
    summary,
    branchId: actor.branchId,
    ipAddress: ip,
    userAgent: agent,
  }
  db().audit.unshift(entry)
  commit()
}

// ── Approvals ─────────────────────────────────────────────────────────────

type ApprovalFields = Pick<Approval, 'type' | 'subject' | 'branchId' | 'reason'> &
  Partial<
    Pick<
      Approval,
      'amount' | 'customerId' | 'customerName' | 'accountId' | 'transactionId' | 'loanId'
    >
  > & {
    payload?: ApprovalRecord['payload']
  }

/**
 * Create a request for a second person to decide. When the requester is the MD or
 * a general manager it is approved and carried out on the spot, and the record
 * says so. If it can't be carried out, nothing is created and a DomainError is thrown.
 */
export function requestApproval(requester: StaffRecord, fields: ApprovalFields): ApprovalRecord {
  const approval: ApprovalRecord = {
    id: newId(),
    status: 'pending',
    amount: null,
    customerId: null,
    customerName: null,
    accountId: null,
    transactionId: null,
    loanId: null,
    branchName: db().branches.find((b) => b.id === fields.branchId)?.name ?? '',
    requestedById: requester.id,
    requestedByName: staffName(requester),
    requestedAt: toLagosIso(),
    decidedByName: null,
    decidedAt: null,
    decisionNote: '',
    payload: {},
    ...fields,
  }
  if (approvesOwnRequests(requester)) {
    // Carry it out first: if it can't be done there is nothing to record.
    executeApproval(approval, requester)
    approval.status = 'approved'
    approval.decidedByName = staffName(requester)
    approval.decidedAt = approval.requestedAt
    approval.decisionNote = `Approved automatically. Raised by the ${ROLE_LABELS[requester.role].toLowerCase()}.`
    db().approvals.unshift(approval)
    audit(
      requester,
      `approval.auto.${approval.type}`,
      'approval',
      approval.id,
      `Approved automatically: ${approval.subject}`,
    )
    return approval
  }
  db().approvals.unshift(approval)
  audit(requester, `approval.request.${approval.type}`, 'approval', approval.id, approval.subject)
  return approval
}

// ── Loans ─────────────────────────────────────────────────────────────────

export function productOf(loan: Pick<LoanRecord, 'productId'>): LoanProduct | undefined {
  return db().loanProducts.find((p) => p.id === loan.productId)
}

/** A loan with its arrears, penalty and next due brought up to date. */
export function current(loan: LoanRecord): LoanRecord {
  return refreshLoan(loan, productOf(loan), todayIso())
}

export function loanForAccount(accountId: string): LoanRecord | undefined {
  const loan = db().loans.find((l) => l.accountId === accountId)
  return loan ? current(loan) : undefined
}

// ── Postings ──────────────────────────────────────────────────────────────

function nextReference(createdAt: string): string {
  const day = lagosDay(createdAt)
  const prefix = `EMS${day.slice(2).replaceAll('-', '')}`
  let max = 0
  for (const t of db().transactions) {
    if (t.reference.startsWith(prefix))
      max = Math.max(max, Number(t.reference.slice(prefix.length)))
  }
  return `${prefix}${String(max + 1).padStart(5, '0')}`
}

/**
 * Apply money to an account and return the new balance.
 * Loan accounts track what is still owed: repayments reduce it, penalties
 * add to it, and reversing a repayment adds it back.
 */
function applyToBalance(
  account: Account,
  type: TransactionType,
  direction: 'credit' | 'debit',
  amount: Kobo,
): Kobo {
  if (account.type !== 'loan') {
    account.balance = kobo(account.balance + (direction === 'credit' ? amount : -amount))
    return account.balance
  }
  const loan = db().loans.find((l) => l.accountId === account.id)
  if (!loan) return account.balance
  if (type === 'penalty') loan.penaltiesCharged = kobo(loan.penaltiesCharged + amount)
  else if (direction === 'credit') loan.amountPaid = kobo(loan.amountPaid + amount)
  else if (type === 'reversal') loan.amountPaid = kobo(loan.amountPaid - amount)
  // Disbursements and processing fees don't change what is owed after set-up.
  current(loan)
  if (loan.outstanding <= 0 && loan.status === 'active') {
    loan.status = 'closed'
    loan.closedAt = toLagosIso()
    account.status = 'closed'
    account.closedAt = loan.closedAt
  } else if (loan.outstanding > 0 && loan.status === 'closed') {
    loan.status = 'active'
    loan.closedAt = null
    account.status = 'active'
    account.closedAt = null
  }
  account.balance = loan.outstanding
  return account.balance
}

export interface PostingInput {
  account: Account
  type: TransactionType
  direction: 'credit' | 'debit'
  amount: Kobo
  channel: TransactionChannel
  postedBy: StaffRecord
  paymentMethod: PaymentMethod | null
  createdAt?: string
  location?: GeoPoint | null
  idempotencyKey?: string | null
  narration?: string | null
  /** Officer credited with a field collection. */
  officer?: StaffRecord | null
}

export function post(input: PostingInput): Transaction {
  const { account } = input
  const createdAt = input.createdAt ?? toLagosIso()
  const customer = db().customers.find((c) => c.id === account.customerId)
  const balanceAfter = applyToBalance(account, input.type, input.direction, input.amount)
  account.lastTransactionAt = createdAt
  const txn: Transaction = {
    id: newId(),
    reference: nextReference(createdAt),
    type: input.type,
    direction: input.direction,
    amount: input.amount,
    balanceAfter,
    accountId: account.id,
    accountNumber: account.accountNumber,
    customerId: account.customerId,
    customerName: customer ? `${customer.firstName} ${customer.lastName}` : account.customerName,
    branchId: account.branchId,
    officerId: input.officer?.id ?? null,
    officerName: input.officer ? staffName(input.officer) : null,
    postedById: input.postedBy.id,
    channel: input.channel,
    paymentMethod: input.paymentMethod,
    status: 'posted',
    location: input.location ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    narration: input.narration ?? null,
    createdAt,
  }
  db().transactions.unshift(txn)
  commit()
  return txn
}

/** Post the opposite entry and mark the original reversed. */
export function reverse(original: Transaction, approver: StaffRecord, reason: string): Transaction {
  const account = db().accounts.find((a) => a.id === original.accountId)
  if (!account) throw new Error('Account missing')
  const reversal = post({
    account,
    type: 'reversal',
    direction: original.direction === 'credit' ? 'debit' : 'credit',
    amount: original.amount,
    channel: 'system',
    postedBy: approver,
    paymentMethod: null,
    narration: `Reversal of ${original.reference}: ${reason}`,
  })
  original.status = 'reversed'
  commit()
  return reversal
}

// ── Accounts ──────────────────────────────────────────────────────────────

/** Numbers follow the format the business chose in Settings. Existing accounts keep theirs. */
function nextAccountNumber(branchCode: string, productCode: string) {
  const format = db().settings.accountNumberFormat ?? DEFAULT_ACCOUNT_NUMBER_FORMAT
  const year = Number(todayIso().slice(0, 4))
  const build = (serial: number) =>
    formatAccountNumber(format, { branchCode, productCode, year, serial })
  try {
    return build(
      nextSerial(
        format,
        db().accounts.map((a) => a.accountNumber),
        build,
      ),
    )
  } catch (e) {
    throw new DomainError(e instanceof Error ? e.message : 'No account number is free.')
  }
}

export function openAccount(
  customerId: string,
  type: 'savings' | 'target' | 'thrift',
  thriftPlanId: string | null,
  target: SavingsTarget | null = null,
): Account {
  const data = db()
  const customer = data.customers.find((c) => c.id === customerId)
  if (!customer) throw new DomainError('Customer not found.')
  const branch = data.branches.find((b) => b.id === customer.branchId)!
  const plan = type === 'thrift' ? data.thriftPlans.find((p) => p.id === thriftPlanId) : undefined
  if (type === 'thrift' && !plan) throw new DomainError('Choose a thrift plan.', 'thriftPlanId')
  const account: Account = {
    id: newId(),
    accountNumber: nextAccountNumber(
      branch.code,
      type === 'savings' ? '10' : type === 'target' ? '11' : plan!.code,
    ),
    type,
    customerId,
    customerName: `${customer.firstName} ${customer.lastName}`,
    branchId: customer.branchId,
    officerId: customer.officerId,
    productId: plan?.id ?? null,
    // A target account is named after the goal, so it reads well in lists.
    productName: type === 'target' ? (target?.goalName ?? null) : (plan?.name ?? null),
    status: 'active',
    balance: ZERO,
    openedAt: toLagosIso(),
    closedAt: null,
    lastTransactionAt: null,
    target: type === 'target' ? target : null,
  }
  data.accounts.push(account)
  commit()
  return account
}

/**
 * Pay out an approved loan: open the loan account, fix the schedule from
 * today, post the disbursement and processing fee, and settle the old loan
 * first if this is a top-up. Returns the cash the customer receives, or, for a
 * buy now pay later purchase, the amount paid to the supplier (the customer
 * gets the item, not cash, and pays the processing fee at handover).
 */
export function disburseLoan(loan: LoanRecord, cashier: StaffRecord, method: PaymentMethod): Kobo {
  const data = db()
  const product = productOf(loan)
  if (!product) throw new DomainError('The loan product no longer exists.')
  if (loan.status !== 'approved')
    throw new DomainError(
      `Only approved loans can be paid out. This one is ${loan.status.replace('_', ' ')}.`,
    )
  const customer = data.customers.find((c) => c.id === loan.customerId)!
  const branch = data.branches.find((b) => b.id === loan.branchId)!

  const old = loan.topUpOfId ? data.loans.find((l) => l.id === loan.topUpOfId) : undefined
  const settle = old ? current(old).outstanding : ZERO
  const bnpl = loan.kind === 'bnpl'
  // The fee was fixed when the application was made.
  const fee = loan.processingFee
  const payout = bnpl ? loan.principal : kobo(loan.principal - fee - settle)
  if (payout <= 0) {
    throw new DomainError(
      `The old loan balance (${formatNaira(settle)}) and fee take up the whole amount. Increase the top-up amount.`,
    )
  }

  const today = todayIso()
  const quote = buildSchedule(
    {
      principal: loan.principal,
      ratePercent: loan.ratePercent,
      interestBasis: loan.interestBasis,
      interestMethod: loan.interestMethod,
      frequency: loan.frequency,
      installmentCount: loan.installmentCount,
    },
    today,
    calendar(),
  )
  const account: Account = {
    id: newId(),
    accountNumber: nextAccountNumber(branch.code, product.code),
    type: 'loan',
    customerId: customer.id,
    customerName: loan.customerName,
    branchId: loan.branchId,
    officerId: customer.officerId,
    productId: product.id,
    productName: product.name,
    status: 'active',
    balance: quote.totalRepayable,
    openedAt: toLagosIso(),
    closedAt: null,
    lastTransactionAt: null,
    target: null,
  }
  data.accounts.push(account)
  Object.assign(loan, {
    accountId: account.id,
    accountNumber: account.accountNumber,
    officerId: customer.officerId,
    schedule: quote.rows,
    interest: quote.interest,
    totalRepayable: quote.totalRepayable,
    installmentAmount: quote.installment,
    maturityDate: quote.maturityDate,
    status: 'active',
    disbursedAt: toLagosIso(),
    disbursedByName: staffName(cashier),
  })

  if (old && settle > 0) {
    const oldAccount = data.accounts.find((a) => a.id === old.accountId)
    if (oldAccount) {
      post({
        account: oldAccount,
        type: 'loan_repayment',
        direction: 'credit',
        amount: settle,
        channel: 'system',
        postedBy: cashier,
        paymentMethod: null,
        narration: `Settled by top-up loan ${loan.loanNumber}`,
      })
    }
  }
  post({
    account,
    type: 'disbursement',
    direction: 'debit',
    amount: loan.principal,
    channel: 'counter',
    postedBy: cashier,
    paymentMethod: method,
    narration: bnpl
      ? `Paid ${loan.supplierName} ${formatNaira(payout)} for ${loan.itemDescription}`
      : `Paid out ${formatNaira(payout)}${settle > 0 ? ` after settling ${old?.loanNumber}` : ''}`,
  })
  if (fee > 0) {
    post({
      account,
      type: 'processing_fee',
      direction: 'debit',
      amount: fee,
      channel: bnpl ? 'counter' : 'system',
      postedBy: cashier,
      paymentMethod: bnpl ? method : null,
      narration: bnpl
        ? 'Collected from the customer at purchase'
        : 'Deducted from the amount paid out',
    })
  }
  current(loan)
  account.balance = loan.outstanding
  commit()
  return payout
}

/** Spread what is left over more installments. No extra interest is added. */
export function extendLoan(loan: LoanRecord, extra: number) {
  current(loan)
  const today = todayIso()
  // Keep installments that are already due; re-plan everything from today on.
  const keep = loan.schedule.filter((r) => r.dueDate < today)
  const future = loan.schedule.filter((r) => r.dueDate >= today)
  const keptTotal = keep.reduce((s, r) => s + r.amount, 0)
  const stillOwedOnSchedule = kobo(Math.max(0, loan.totalRepayable - keptTotal))
  const rows = respread(
    stillOwedOnSchedule,
    future.length + extra,
    loan.frequency,
    today,
    keep.length + 1,
    calendar(),
  )
  loan.schedule = [...keep, ...rows]
  loan.installmentCount = loan.schedule.length
  loan.maturityDate = rows[rows.length - 1]?.dueDate ?? loan.maturityDate
  loan.extensions += 1
  current(loan)
  commit()
}

// ── Today's dues ──────────────────────────────────────────────────────────

const COLLECTION_TYPES: TransactionType[] = ['thrift_contribution', 'loan_repayment']

export function isCollection(t: Transaction) {
  return t.channel === 'field' && COLLECTION_TYPES.includes(t.type) && t.status !== 'reversed'
}

function collectedOn(accountId: string, day: string): Kobo {
  return kobo(
    db()
      .transactions.filter(
        (t) =>
          t.accountId === accountId &&
          COLLECTION_TYPES.includes(t.type) &&
          t.status !== 'reversed' &&
          lagosDay(t.createdAt) === day,
      )
      .reduce((n, t) => n + t.amount, 0),
  )
}

function dueForAccount(account: Account, day: string): Due | null {
  // A loan paid off today closes, but its last installment was still due today.
  const closedToday =
    account.status === 'closed' && account.closedAt !== null && lagosDay(account.closedAt) === day
  if (account.status !== 'active' && !(account.type === 'loan' && closedToday)) return null
  const collectedToday = collectedOn(account.id, day)
  const cal = calendar()
  if (account.type === 'thrift') {
    const plan = db().thriftPlans.find((p) => p.id === account.productId)
    if (!plan || !isOpen(day, cal)) return null
    const payDay = weekday(account.openedAt.slice(0, 10)) || 1
    if (plan.frequency === 'weekly' && weekday(day) !== payDay) return null
    return {
      accountId: account.id,
      accountNumber: account.accountNumber,
      kind: 'thrift',
      productName: plan.name,
      amountDue: plan.contributionAmount,
      arrears: ZERO,
      collectedToday,
    }
  }
  if (account.type === 'loan') {
    const loan = loanForAccount(account.id)
    if (!loan || (loan.status !== 'active' && !(loan.status === 'closed' && closedToday)))
      return null
    const row = loan.schedule.find((r) => r.dueDate === day)
    const amountDue = row ? kobo(Math.min(row.amount, loan.outstanding + collectedToday)) : ZERO
    if (amountDue === 0 && loan.arrears === 0 && collectedToday === 0) return null
    return {
      accountId: account.id,
      accountNumber: account.accountNumber,
      kind: 'loan',
      productName: loan.productName,
      amountDue,
      arrears: loan.arrears,
      collectedToday,
    }
  }
  return null
}

export function todayItems(officer: StaffRecord, day: string): TodayItem[] {
  const { customers, accounts } = db()
  // Index the officer's accounts by customer once, rather than scanning every account per customer.
  const byCustomer = new Map<string, Account[]>()
  for (const a of accounts) {
    if (a.officerId !== officer.id) continue
    const list = byCustomer.get(a.customerId)
    if (list) list.push(a)
    else byCustomer.set(a.customerId, [a])
  }
  const items: TodayItem[] = []
  for (const customer of customers) {
    if (customer.officerId !== officer.id || customer.status !== 'active') continue
    const dues = (byCustomer.get(customer.id) ?? [])
      .map((a) => dueForAccount(a, day))
      .filter((d): d is Due => d !== null)
    if (dues.length === 0) continue
    items.push({
      customerId: customer.id,
      customerName: `${customer.firstName} ${customer.lastName}`,
      phone: customer.phone,
      address: customer.address,
      area: customer.area,
      dues,
    })
  }
  return items
}

// ── Remittance ────────────────────────────────────────────────────────────

export function remittanceRow(officer: StaffRecord, day: string): Remittance {
  const { remittances, staff, branches } = db()
  const collections = db().transactions.filter(
    (t) => t.officerId === officer.id && isCollection(t) && lagosDay(t.createdAt) === day,
  )
  const expectedCash = kobo(
    collections.filter((t) => t.paymentMethod === 'cash').reduce((n, t) => n + t.amount, 0),
  )
  const transferTotal = kobo(
    collections.filter((t) => t.paymentMethod === 'transfer').reduce((n, t) => n + t.amount, 0),
  )
  const record = remittances.find((r) => r.officerId === officer.id && r.date === day)
  const confirmedBy = record?.confirmedById
    ? staff.find((s) => s.id === record.confirmedById)
    : undefined
  const cashReceived = record?.cashReceived ?? null
  return {
    id: record?.id ?? null,
    date: day,
    officerId: officer.id,
    officerName: staffName(officer),
    branchId: officer.branchId!,
    branchName: branches.find((b) => b.id === officer.branchId)?.name ?? '',
    collectionsCount: collections.length,
    expectedCash,
    transferTotal,
    status: !record ? 'not_submitted' : cashReceived !== null ? 'confirmed' : 'submitted',
    submittedAt: record?.submittedAt ?? null,
    cashReceived,
    variance: cashReceived !== null ? kobo(cashReceived - expectedCash) : null,
    confirmedByName: confirmedBy ? staffName(confirmedBy) : null,
    confirmedAt: record?.confirmedAt ?? null,
    note: record?.note ?? '',
  }
}

// ── Carrying out approvals ────────────────────────────────────────────────

/** Carry out an approved request. Throws DomainError if it can no longer be done. */
export function executeApproval(approval: ApprovalRecord, approver: StaffRecord) {
  const data = db()
  switch (approval.type) {
    case 'customer_registration': {
      const customer = data.customers.find((c) => c.id === approval.customerId)
      if (!customer) throw new DomainError('This customer record no longer exists.')
      customer.status = 'active'
      const plan = data.thriftPlans.find(
        (p) => p.id === approval.payload.thriftPlanId && p.status === 'active',
      )
      if (plan) openAccount(customer.id, 'thrift', plan.id)
      break
    }
    case 'transaction_reversal': {
      const txn = data.transactions.find((t) => t.id === approval.transactionId)
      if (!txn) throw new DomainError('The transaction no longer exists.')
      if (txn.status === 'reversed')
        throw new DomainError('This transaction has already been reversed.')
      reverse(txn, approver, approval.reason)
      break
    }
    case 'account_closure': {
      const account = data.accounts.find((a) => a.id === approval.accountId)
      if (!account) throw new DomainError('The account no longer exists.')
      if (account.balance !== 0)
        throw new DomainError(
          'The account has a balance again. Pay it out before closing the account.',
        )
      account.status = 'closed'
      account.closedAt = toLagosIso()
      break
    }
    case 'large_withdrawal': {
      const posting = approval.payload.posting
      const account = data.accounts.find((a) => a.id === posting?.accountId)
      if (!posting || !account) throw new DomainError('The account no longer exists.')
      if (account.balance < posting.amount)
        throw new DomainError('The balance is now lower than the withdrawal amount.')
      const requester = data.staff.find((s) => s.id === approval.requestedById) ?? approver
      post({
        account,
        type: 'withdrawal',
        direction: 'debit',
        amount: posting.amount,
        channel: 'counter',
        postedBy: requester,
        paymentMethod: posting.paymentMethod,
        narration: posting.narration || null,
      })
      break
    }
    case 'loan_application': {
      const loan = data.loans.find((l) => l.id === approval.loanId)
      if (!loan || loan.status !== 'pending_approval')
        throw new DomainError('This loan is no longer waiting for approval.')
      loan.status = 'approved'
      loan.approvedByName = staffName(approver)
      break
    }
    case 'loan_extension': {
      const loan = data.loans.find((l) => l.id === approval.loanId)
      if (!loan || loan.status !== 'active')
        throw new DomainError('Only active loans can be extended.')
      extendLoan(loan, approval.payload.extraInstallments ?? 1)
      break
    }
  }
  commit()
}

/** Undo the hold placed when the request was made. */
export function releaseRejected(approval: ApprovalRecord) {
  const data = db()
  if (approval.type === 'transaction_reversal') {
    const txn = data.transactions.find((t) => t.id === approval.transactionId)
    if (txn && txn.status === 'pending_reversal') txn.status = 'posted'
  }
  if (approval.type === 'customer_registration') {
    const customer = data.customers.find((c) => c.id === approval.customerId)
    if (customer) customer.status = 'inactive'
  }
  if (approval.type === 'loan_application') {
    const loan = data.loans.find((l) => l.id === approval.loanId)
    if (loan && loan.status === 'pending_approval') loan.status = 'rejected'
  }
  commit()
}
