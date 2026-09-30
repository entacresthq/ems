import { delay, http, HttpResponse } from 'msw'
import { formatDate, formatDateTime, toLagosIso, todayIso } from '@/lib/dates'
import { formatNaira, kobo, ZERO, type Kobo } from '@/lib/money'
import type { CounterPostingRequest, Transaction, TransactionType } from '@/types'
import {
  ACCOUNT_TYPE_LABELS,
  approvesOwnRequests,
  TRANSACTION_EDITOR_ROLES,
  TRANSACTION_TYPE_LABELS,
} from '@/types'
import { commit, db } from '../db'
import {
  DomainError,
  editTransaction,
  executeApproval,
  audit,
  largeWithdrawalThreshold,
  requestApproval,
  settings,
  lagosDay,
  loanForAccount,
  newId,
  post,
  postWithdrawal,
  releaseRejected,
  remittanceRow,
  staffName,
  thriftWithdrawalProblem,
  withdrawalChargeOn,
} from '../domain'
import { out } from '../serializers'
import {
  api,
  applyOrdering,
  authenticate,
  badRequest,
  can,
  conflict,
  filterBySearch,
  forbidden,
  inScope,
  notFound,
  paginate,
  param,
  parseMoney,
  readBody,
  scopeRows,
  validationError,
} from '../utils'

const REVERSIBLE: TransactionType[] = [
  'thrift_contribution',
  'loan_repayment',
  'deposit',
  'withdrawal',
  'thrift_payout',
  // Reversing either side undoes the whole transfer.
  'transfer_out',
  'transfer_in',
]

/** Counted cash may be zero, unlike payment amounts. */
function parseCash(value: unknown): Kobo | null {
  if (value === '0' || value === '0.00' || value === 0) return ZERO
  return parseMoney(value)
}

export const operationHandlers = [
  // ── Transactions ───────────────────────────────────────────────────────
  http.get(api('/transactions/'), async ({ request }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'transactions.view') && !can(staff, 'accounts.view')) return forbidden()
    let rows: Transaction[] = scopeRows(staff, db().transactions)
    const filters = {
      branch: 'branchId',
      officer: 'officerId',
      customer: 'customerId',
      account: 'accountId',
      type: 'type',
      status: 'status',
      channel: 'channel',
    } as const
    for (const [key, field] of Object.entries(filters)) {
      const value = param(request, key)
      if (value) rows = rows.filter((t) => t[field] === value)
    }
    const from = param(request, 'date_from')
    const to = param(request, 'date_to')
    if (from) rows = rows.filter((t) => lagosDay(t.createdAt) >= from)
    if (to) rows = rows.filter((t) => lagosDay(t.createdAt) <= to)
    rows = filterBySearch(rows, param(request, 'search'), [
      (t) => t.reference,
      (t) => t.customerName,
      (t) => t.accountNumber,
    ])
    rows = applyOrdering(rows, param(request, 'ordering') ?? '-created_at', [
      'created_at',
      'amount',
      'reference',
      'customer_name',
      'type',
    ])
    return paginate(request, rows, out.transaction)
  }),

  http.get(api('/transactions/:id/'), async ({ request, params }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    const txn = db().transactions.find((t) => t.id === params.id)
    if (!txn || !inScope(staff, txn)) return notFound()
    return HttpResponse.json(out.transaction(txn))
  }),

  // Walk-in postings at the counter.
  http.post(api('/transactions/'), async ({ request }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'transactions.post')) return forbidden()
    const body = await readBody<CounterPostingRequest>(request)
    const account = db().accounts.find((a) => a.id === body.accountId)
    if (!account || !inScope(staff, account))
      return validationError({ accountId: ['Find the account by its number.'] })
    if (account.status === 'frozen')
      return badRequest(
        `Account ${account.accountNumber} is frozen. A branch manager must unfreeze it first.`,
      )
    if (account.status === 'dormant')
      return badRequest(
        `Account ${account.accountNumber} is dormant. Reactivate it before posting.`,
      )
    if (account.status === 'closed')
      return badRequest(`Account ${account.accountNumber} is closed.`)
    const allowed: Record<string, CounterPostingRequest['type'][]> = {
      savings: ['deposit', 'withdrawal'],
      target: ['deposit', 'withdrawal'],
      thrift: ['thrift_contribution', 'withdrawal'],
      loan: ['loan_repayment'],
    }
    const type = body.type
    if (!type || !allowed[account.type]!.includes(type)) {
      return validationError({
        type: [
          `A ${account.type} account can take: ${allowed[account.type]!.map((t) => TRANSACTION_TYPE_LABELS[t].toLowerCase()).join(', ')}.`,
        ],
      })
    }
    const amount = parseMoney(body.amount)
    if (!amount) return validationError({ amount: ['Enter an amount greater than ₦0.'] })
    const paymentMethod = body.paymentMethod === 'transfer' ? 'transfer' : 'cash'
    const narration = typeof body.narration === 'string' ? body.narration.trim() : ''

    const charge = type === 'withdrawal' ? withdrawalChargeOn(account, amount) : ZERO
    if (type === 'withdrawal' && amount + charge > account.balance) {
      return validationError({
        amount: [
          charge > 0
            ? `The balance is only ${formatNaira(account.balance)}. This withdrawal and its ${formatNaira(charge)} charge need ${formatNaira(kobo(amount + charge))}.`
            : `The balance is only ${formatNaira(account.balance)}.`,
        ],
      })
    }
    if (type === 'withdrawal') {
      const thriftProblem = thriftWithdrawalProblem(account)
      if (thriftProblem) return badRequest(thriftProblem, 'thrift_cycle_open')
    }
    if (type === 'withdrawal' && account.target?.lockUntilReached) {
      // A locked goal opens once enough is saved or the target date has come.
      const reached = account.balance >= account.target.targetAmount
      if (!reached && todayIso() < account.target.targetDate) {
        return badRequest(
          `This account is locked until the goal "${account.target.goalName}" is reached (${formatNaira(account.target.targetAmount)}) or ${formatDate(account.target.targetDate)}.`,
        )
      }
    }
    if (type === 'loan_repayment') {
      const loan = loanForAccount(account.id)
      if (loan && amount > loan.outstanding) {
        return validationError({
          amount: [`That is more than the ${formatNaira(loan.outstanding)} left on the loan.`],
        })
      }
    }

    const largeWithdrawal = type === 'withdrawal' && amount >= largeWithdrawalThreshold()
    // The MD and general managers approve these for everyone else, so theirs go straight through.
    const selfApproved = largeWithdrawal && approvesOwnRequests(staff)
    if (largeWithdrawal && !selfApproved) {
      const approval = requestApproval(staff, {
        type: 'large_withdrawal',
        subject: `Withdraw ${formatNaira(amount)} from ${ACCOUNT_TYPE_LABELS[account.type].toLowerCase()} ${account.accountNumber} for ${account.customerName}`,
        amount,
        branchId: account.branchId,
        customerId: account.customerId,
        customerName: account.customerName,
        accountId: account.id,
        reason: narration || 'Large withdrawal at the counter.',
        payload: { posting: { accountId: account.id, type, amount, paymentMethod, narration } },
      })
      return HttpResponse.json(
        { status: 'pending_approval', approval: out.approval(approval) },
        { status: 202 },
      )
    }

    const posted =
      type === 'withdrawal'
        ? postWithdrawal({
            account,
            amount,
            postedBy: staff,
            paymentMethod,
            narration: narration || null,
          })
        : {
            withdrawal: post({
              account,
              type,
              direction: 'credit',
              amount,
              channel: 'counter',
              postedBy: staff,
              paymentMethod,
              narration: narration || null,
            }),
            charge: null,
          }
    const txn = posted.withdrawal
    audit(
      staff,
      'transaction.post',
      'transaction',
      txn.id,
      `${TRANSACTION_TYPE_LABELS[type]} of ${formatNaira(amount)} on ${account.accountNumber} (${txn.reference})${posted.charge ? ` with a ${formatNaira(posted.charge.amount)} charge` : ''}${selfApproved ? '. Above the approval limit, approved automatically' : ''}`,
    )
    return HttpResponse.json(
      {
        status: 'posted',
        transaction: out.transaction(txn),
        charge: posted.charge ? out.transaction(posted.charge) : null,
      },
      { status: 201 },
    )
  }),

  // Corrections by the MD or a general manager: amount, date, payment method, note.
  http.patch(api('/transactions/:id/'), async ({ request, params }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!TRANSACTION_EDITOR_ROLES.includes(staff.role) || !can(staff, 'transactions.edit'))
      return forbidden('Only the MD, general managers and branch managers can edit transactions.')
    const txn = db().transactions.find((t) => t.id === params.id)
    if (!txn || !inScope(staff, txn)) return notFound()
    const body = await readBody<Record<string, unknown>>(request)
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (reason.length < 10)
      return validationError({ reason: ['Say why it is being changed (at least 10 characters).'] })
    let amount: Kobo | undefined
    if (body.amount !== undefined) {
      amount = parseMoney(body.amount) ?? undefined
      if (amount === undefined)
        return validationError({ amount: ['Enter an amount greater than ₦0.'] })
    }
    const method = body.paymentMethod
    if (method !== undefined && method !== 'cash' && method !== 'transfer')
      return validationError({ paymentMethod: ['Choose cash or transfer.'] })
    try {
      editTransaction(
        txn,
        {
          amount,
          createdAt: typeof body.createdAt === 'string' ? body.createdAt : undefined,
          paymentMethod: method,
          narration: typeof body.narration === 'string' ? body.narration : undefined,
        },
        staff,
        reason,
      )
    } catch (e) {
      if (e instanceof DomainError)
        return e.field ? validationError({ [e.field]: [e.message] }) : badRequest(e.message)
      throw e
    }
    const last = txn.edits!.at(-1)!
    audit(
      staff,
      'transaction.edit',
      'transaction',
      txn.id,
      `Edited ${TRANSACTION_TYPE_LABELS[txn.type].toLowerCase()} ${txn.reference} on ${txn.accountNumber}: ${last.changes
        .map(
          (c) => `${c.field === 'paymentMethod' ? 'payment method' : c.field} ${c.from} → ${c.to}`,
        )
        .join('; ')}. Reason: ${reason}`,
    )
    return HttpResponse.json(out.transaction(txn))
  }),

  http.post(api('/transactions/:id/reversal-request/'), async ({ request, params }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'transactions.request_reversal')) return forbidden()
    const txn = db().transactions.find((t) => t.id === params.id)
    if (!txn || !inScope(staff, txn)) return notFound()
    const body = await readBody<{ reason: string }>(request)
    const reason = (body.reason ?? '').trim()
    if (reason.length < 10)
      return validationError({ reason: ['Say why it must be reversed (at least 10 characters).'] })
    if (txn.status === 'pending_reversal')
      return conflict('A reversal for this transaction is already waiting for approval.')
    if (txn.status === 'reversed') return conflict('This transaction has already been reversed.')
    if (!REVERSIBLE.includes(txn.type)) {
      return badRequest(
        `${TRANSACTION_TYPE_LABELS[txn.type]} entries can't be reversed here. Contact head office.`,
      )
    }
    const ageDays = (Date.now() - new Date(txn.createdAt).getTime()) / 86_400_000
    const windowDays = settings().reversalWindowDays
    if (ageDays > windowDays) {
      return badRequest(
        `Transactions older than ${windowDays} days can't be reversed. Post a correcting entry instead.`,
      )
    }
    const before = txn.status
    txn.status = 'pending_reversal'
    try {
      const approval = requestApproval(staff, {
        type: 'transaction_reversal',
        subject: `Reverse ${txn.reference}: ${TRANSACTION_TYPE_LABELS[txn.type].toLowerCase()} from ${txn.customerName}`,
        amount: txn.amount,
        branchId: txn.branchId,
        customerId: txn.customerId,
        customerName: txn.customerName,
        accountId: txn.accountId,
        transactionId: txn.id,
        reason,
      })
      return HttpResponse.json(out.approval(approval), { status: 201 })
    } catch (e) {
      txn.status = before
      if (e instanceof DomainError) return badRequest(e.message)
      throw e
    }
  }),

  // ── Remittance ─────────────────────────────────────────────────────────
  http.get(api('/remittances/'), async ({ request }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'remittance.view')) return forbidden()
    const day = param(request, 'date') ?? todayIso()
    const branch = param(request, 'branch')
    const officers = db()
      .staff.filter((s) => s.role === 'account_officer')
      .filter((s) =>
        can(staff, 'branches.all')
          ? !branch || s.branchId === branch
          : s.branchId === staff.branchId,
      )
    const rows = officers
      .map((o) => remittanceRow(o, day))
      // Suspended officers only appear if they collected something.
      .filter((r, i) => officers[i]!.status === 'active' || r.collectionsCount > 0 || r.id)
      .sort(
        (a, b) =>
          a.branchName.localeCompare(b.branchName) || a.officerName.localeCompare(b.officerName),
      )
    return paginate(request, rows, out.remittance)
  }),

  http.post(api('/remittances/confirm/'), async ({ request }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'remittance.confirm')) return forbidden()
    const body = await readBody<{
      officerId: string
      date: string
      cashReceived: string
      note: string
    }>(request)
    const officer = db().staff.find((s) => s.id === body.officerId && s.role === 'account_officer')
    if (!officer || !inScope(staff, { branchId: officer.branchId! })) return notFound()
    const day = body.date ?? todayIso()
    if (day > todayIso()) return validationError({ date: ["You can't confirm a future date."] })
    const received = parseCash(body.cashReceived)
    if (received === null)
      return validationError({ cashReceived: ['Enter the cash you counted, or 0.'] })
    const row = remittanceRow(officer, day)
    if (row.status === 'confirmed') {
      return conflict(
        `Already confirmed by ${row.confirmedByName} at ${formatDateTime(row.confirmedAt!)}.`,
      )
    }
    const note = (body.note ?? '').trim()
    if (received !== row.expectedCash && note.length < 5) {
      return validationError({
        note: ['The cash does not match. Explain the difference before signing off.'],
      })
    }
    let record = db().remittances.find((r) => r.officerId === officer.id && r.date === day)
    if (!record) {
      record = {
        id: newId(),
        date: day,
        officerId: officer.id,
        branchId: officer.branchId!,
        submittedAt: toLagosIso(),
        submittedExpectedCash: row.expectedCash,
        cashReceived: null,
        confirmedById: null,
        confirmedAt: null,
        note: '',
      }
      db().remittances.push(record)
    }
    record.cashReceived = received
    record.confirmedById = staff.id
    record.confirmedAt = toLagosIso()
    record.note = note
    commit()
    audit(
      staff,
      'remittance.confirm',
      'remittance',
      record.id,
      `Counted ${formatNaira(received)} from ${staffName(officer)} for ${day}${note ? `: ${note}` : ''}`,
    )
    return HttpResponse.json(out.remittance(remittanceRow(officer, day)))
  }),

  // ── Approvals ──────────────────────────────────────────────────────────
  http.get(api('/approvals/'), async ({ request }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'approvals.view')) return forbidden()
    let rows = scopeRows(staff, db().approvals)
    // Staff who cannot decide only see requests they made.
    if (!can(staff, 'approvals.decide')) rows = rows.filter((a) => a.requestedById === staff.id)
    for (const key of ['status', 'type'] as const) {
      const value = param(request, key)
      if (value) rows = rows.filter((a) => a[key] === value)
    }
    const refs = {
      branch: 'branchId',
      customer: 'customerId',
      account: 'accountId',
      transaction: 'transactionId',
      loan: 'loanId',
    } as const
    for (const [key, field] of Object.entries(refs)) {
      const value = param(request, key)
      if (value) rows = rows.filter((a) => a[field] === value)
    }
    rows = filterBySearch(rows, param(request, 'search'), [
      (a) => a.subject,
      (a) => a.customerName,
      (a) => a.requestedByName,
    ])
    rows = applyOrdering(rows, param(request, 'ordering') ?? '-requested_at', [
      'requested_at',
      'decided_at',
      'amount',
      'type',
    ])
    return paginate(request, rows, out.approval)
  }),

  http.get(api('/approvals/:id/'), async ({ request, params }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    const approval = db().approvals.find((a) => a.id === params.id)
    if (!approval || !inScope(staff, approval)) return notFound()
    return HttpResponse.json(out.approval(approval))
  }),

  http.post(api('/approvals/:id/:decision/'), async ({ request, params }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    const decision = params.decision
    if (decision !== 'approve' && decision !== 'reject') return notFound()
    if (!can(staff, 'approvals.decide')) return forbidden()
    const approval = db().approvals.find((a) => a.id === params.id)
    if (!approval || !inScope(staff, approval)) return notFound()
    if (approval.status !== 'pending') {
      return conflict(`This request was already ${approval.status} by ${approval.decidedByName}.`)
    }
    if (approval.requestedById === staff.id) {
      return forbidden('You made this request, so someone else must approve or reject it.')
    }
    const body = await readBody<{ note: string }>(request)
    const note = (body.note ?? '').trim()
    if (decision === 'reject' && note.length < 5) {
      return validationError({
        note: ['Say why you are rejecting it, so the requester knows what to fix.'],
      })
    }
    try {
      if (decision === 'approve') executeApproval(approval, staff)
      else releaseRejected(approval)
    } catch (e) {
      if (e instanceof DomainError) return badRequest(e.message)
      throw e
    }
    approval.status = decision === 'approve' ? 'approved' : 'rejected'
    approval.decidedByName = staffName(staff)
    approval.decidedAt = toLagosIso()
    approval.decisionNote = note
    commit()
    audit(
      staff,
      `approval.${decision}.${approval.type}`,
      'approval',
      approval.id,
      `${decision === 'approve' ? 'Approved' : 'Rejected'}: ${approval.subject}${note ? ` (${note})` : ''}`,
    )
    return HttpResponse.json(out.approval(approval))
  }),
]
