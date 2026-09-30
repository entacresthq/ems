import { delay, http, HttpResponse } from 'msw'
import { formatNaira } from '@/lib/money'
import { approvesOwnRequests, type AccountEnquiry, type TransferRequest } from '@/types'
import { db } from '../db'
import {
  audit,
  largeWithdrawalThreshold,
  postTransfer,
  requestApproval,
  transferProblem,
} from '../domain'
import { out } from '../serializers'
import {
  api,
  authenticate,
  can,
  forbidden,
  inScope,
  notFound,
  param,
  parseMoney,
  readBody,
  serialize,
  validationError,
} from '../utils'

/**
 * Transfers between accounts: a customer's own, or to another customer. The
 * money comes from an account in the teller's branch; it can go to any branch.
 */
export const transferHandlers = [
  // Name check before sending money to an account number.
  http.get(api('/transfers/name-enquiry/'), async ({ request }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'transactions.post')) return forbidden()
    const number = (param(request, 'account_number') ?? '').replace(/\s+/g, '').toUpperCase()
    const account = db().accounts.find((a) => a.accountNumber === number)
    if (!account) return notFound()
    const enquiry: AccountEnquiry = {
      id: account.id,
      accountNumber: account.accountNumber,
      customerId: account.customerId,
      customerName: account.customerName,
      type: account.type,
      productName: account.productName,
      branchName: db().branches.find((b) => b.id === account.branchId)?.name ?? '',
      status: account.status,
    }
    return HttpResponse.json(serialize(enquiry))
  }),

  http.post(api('/transfers/'), async ({ request }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'transactions.post')) return forbidden()
    const body = await readBody<Record<string, unknown>>(request)
    const from = db().accounts.find((a) => a.id === body.fromAccountId)
    if (from && !inScope(staff, from))
      return validationError({ fromAccountId: ['That account isn’t in your branch.'] })
    const to = db().accounts.find((a) => a.id === body.toAccountId)
    const amount = parseMoney(body.amount)
    if (!amount) return validationError({ amount: ['Enter an amount greater than ₦0.'] })
    const narration = typeof body.narration === 'string' ? body.narration.trim().slice(0, 140) : ''
    const problem = transferProblem(from, to, amount)
    if (problem) return validationError({ [problem[0]]: [problem[1]] })
    const source = from!
    const target = to!
    const sameCustomer = source.customerId === target.customerId
    const summary = `${formatNaira(amount)} from ${source.accountNumber} (${source.customerName}) to ${target.accountNumber} (${target.customerName})`

    // Large transfers wait for a manager, like large withdrawals.
    if (amount >= largeWithdrawalThreshold() && !approvesOwnRequests(staff)) {
      const payload: TransferRequest = {
        fromAccountId: source.id,
        toAccountId: target.id,
        amount,
        narration,
      }
      const approval = requestApproval(staff, {
        type: 'large_transfer',
        subject: `Transfer ${summary}`,
        amount,
        branchId: source.branchId,
        customerId: source.customerId,
        customerName: source.customerName,
        accountId: source.id,
        reason: narration || 'Large transfer at the counter.',
        payload: { transfer: payload },
      })
      return HttpResponse.json(
        { status: 'pending_approval', approval: out.approval(approval) },
        { status: 202 },
      )
    }

    const { debit, credit } = postTransfer({
      from: source,
      to: target,
      amount,
      postedBy: staff,
      narration: narration || null,
    })
    audit(
      staff,
      'transfer.post',
      'transaction',
      debit.id,
      `Transferred ${summary}${sameCustomer ? ', between the customer’s own accounts' : ''} (${debit.reference}, ${credit.reference})`,
    )
    return HttpResponse.json(
      { status: 'posted', debit: out.transaction(debit), credit: out.transaction(credit) },
      { status: 201 },
    )
  }),
]
