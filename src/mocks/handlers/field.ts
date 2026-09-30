import { delay, http, HttpResponse } from 'msw'
import { formatDate, toLagosIso, todayIso } from '@/lib/dates'
import { formatNaira, kobo } from '@/lib/money'
import { maskPhone } from '@/lib/phone'
import type { CollectionRequest, DaySummary, GeoPoint, PaymentMethod } from '@/types'
import { commit, db } from '../db'
import {
  audit,
  settings,
  isCollection,
  lagosDay,
  loanForAccount,
  newId,
  post,
  remittanceRow,
  sendTemplateSms,
  staffName,
  todayItems,
} from '../domain'
import type { StaffRecord } from '../seed/generate'
import { out } from '../serializers'
import {
  api,
  authenticate,
  badRequest,
  can,
  conflict,
  forbidden,
  param,
  parseMoney,
  readBody,
  validationError,
} from '../utils'

function officerOnly(request: Request): StaffRecord | Response {
  const staff = authenticate(request)
  if (staff instanceof Response) return staff
  if (!can(staff, 'field.collect')) return forbidden('Only account officers can use the field app.')
  return staff
}

export const fieldHandlers = [
  http.get(api('/field/today/'), async ({ request }) => {
    await delay()
    const staff = officerOnly(request)
    if (staff instanceof Response) return staff
    const day = todayIso()
    return HttpResponse.json({ date: day, items: todayItems(staff, day).map(out.todayItem) })
  }),

  http.get(api('/field/portfolio/'), async ({ request }) => {
    await delay()
    const staff = officerOnly(request)
    if (staff instanceof Response) return staff
    const { customers, accounts, loans } = db()
    return HttpResponse.json({
      customers: customers.filter((c) => c.officerId === staff.id).map(out.customer),
      accounts: accounts.filter((a) => a.officerId === staff.id).map(out.account),
      loans: loans.filter((l) => l.officerId === staff.id).map(out.loan),
    })
  }),

  http.post(api('/collections/'), async ({ request }) => {
    await delay()
    const staff = officerOnly(request)
    if (staff instanceof Response) return staff
    const body = await readBody<CollectionRequest>(request)
    const key = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : ''
    if (!/^[0-9a-f-]{36}$/i.test(key)) return badRequest('Missing idempotency key.')

    // Same key again (e.g. a retry after a dropped connection): return the original.
    const existing = db().transactions.find((t) => t.idempotencyKey === key)
    if (existing) {
      const customer = db().customers.find((c) => c.id === existing.customerId)
      return HttpResponse.json(
        {
          transaction: out.transaction(existing),
          receipt: { sms_status: 'sent', phone: maskPhone(customer?.phone ?? '') },
        },
        { status: 200 },
      )
    }

    const account = db().accounts.find((a) => a.id === body.accountId)
    if (!account || account.officerId !== staff.id) {
      return validationError({
        accountId: ['This account is not assigned to you. Ask your branch manager.'],
      })
    }
    const customer = db().customers.find((c) => c.id === account.customerId)!
    if (account.status !== 'active') {
      return badRequest(
        `Account ${account.accountNumber} is ${account.status}, so it can't take collections. Give any cash back and tell your branch manager.`,
        'account_not_active',
      )
    }
    if (account.type === 'savings' || account.type === 'target')
      return validationError({
        accountId: ['Savings deposits are taken at the counter, not in the field.'],
      })
    const amount = parseMoney(body.amount)
    if (!amount) return validationError({ amount: ['Enter an amount greater than ₦0.'] })
    if (account.type === 'loan') {
      const loan = loanForAccount(account.id)
      if (loan && amount > loan.outstanding) {
        return validationError({
          amount: [`That is more than the ${formatNaira(loan.outstanding)} left on the loan.`],
        })
      }
    }
    const method: PaymentMethod = body.paymentMethod === 'transfer' ? 'transfer' : 'cash'

    const collectedAt =
      typeof body.collectedAt === 'string' ? new Date(body.collectedAt) : new Date()
    if (Number.isNaN(collectedAt.getTime()))
      return validationError({ collectedAt: ['Invalid time.'] })
    if (collectedAt.getTime() > Date.now() + 5 * 60_000) {
      return validationError({
        collectedAt: ["The phone's clock is ahead. Set the correct time and try again."],
      })
    }
    const maxAgeDays = settings().fieldSyncMaxAgeDays
    if (Date.now() - collectedAt.getTime() > maxAgeDays * 86_400_000) {
      return badRequest(
        `Collections older than ${maxAgeDays} days can't be synced. Give the cash to the accountant to post at the counter.`,
        'too_old',
      )
    }
    const location = body.location as GeoPoint | null | undefined

    const txn = post({
      account,
      type: account.type === 'loan' ? 'loan_repayment' : 'thrift_contribution',
      direction: 'credit',
      amount,
      channel: 'field',
      postedBy: staff,
      officer: staff,
      paymentMethod: method,
      createdAt: toLagosIso(collectedAt),
      location: location ?? null,
      idempotencyKey: key,
    })
    audit(
      staff,
      'collection.record',
      'transaction',
      txn.id,
      `Collected ${formatNaira(amount)} ${method} for ${account.accountNumber} (${txn.reference})`,
    )
    sendTemplateSms(customer.phone, 'collection_receipt', {
      customer_name: `${customer.firstName} ${customer.lastName}`,
      amount: formatNaira(amount),
      account_type: account.type,
      account_number: account.accountNumber,
      date: formatDate(txn.createdAt),
      balance: formatNaira(account.balance),
      reference: txn.reference,
      officer_name: staffName(staff),
    })
    return HttpResponse.json(
      {
        transaction: out.transaction(txn),
        receipt: { sms_status: 'sent', phone: maskPhone(customer.phone) },
      },
      { status: 201 },
    )
  }),

  http.get(api('/field/day-summary/'), async ({ request }) => {
    await delay()
    const staff = officerOnly(request)
    if (staff instanceof Response) return staff
    const day = param(request, 'date') ?? todayIso()
    const collections = db().transactions.filter(
      (t) => t.officerId === staff.id && isCollection(t) && lagosDay(t.createdAt) === day,
    )
    const sum = (method?: PaymentMethod) =>
      kobo(
        collections
          .filter((t) => !method || t.paymentMethod === method)
          .reduce((n, t) => n + t.amount, 0),
      )
    const due = day === todayIso() ? todayItems(staff, day) : []
    const visited = new Set(collections.map((t) => t.customerId))
    const summary: DaySummary = {
      date: day,
      totalCollected: sum(),
      cashTotal: sum('cash'),
      transferTotal: sum('transfer'),
      collectionsCount: collections.length,
      customersDue: due.length,
      customersVisited: due.filter((d) => visited.has(d.customerId)).length,
      missed: due
        .filter((d) => !visited.has(d.customerId))
        .map((d) => ({
          customerId: d.customerId,
          customerName: d.customerName,
          area: d.area,
          amountDue: kobo(d.dues.reduce((n, x) => n + x.amountDue + x.arrears, 0)),
        })),
      remittance: remittanceRow(staff, day),
    }
    return HttpResponse.json(out.daySummary(summary))
  }),

  // Officer submits the day's cash for the accountant to count.
  http.post(api('/remittances/'), async ({ request }) => {
    await delay()
    const staff = officerOnly(request)
    if (staff instanceof Response) return staff
    const body = await readBody<{ date: string }>(request)
    const day = body.date ?? todayIso()
    if (day !== todayIso())
      return validationError({ date: ["You can only submit today's remittance."] })
    if (db().remittances.some((r) => r.officerId === staff.id && r.date === day)) {
      return conflict('You have already submitted today’s remittance.')
    }
    const row = remittanceRow(staff, day)
    if (row.collectionsCount === 0) return badRequest('There are no collections to submit today.')
    db().remittances.push({
      id: newId(),
      date: day,
      officerId: staff.id,
      branchId: staff.branchId!,
      submittedAt: toLagosIso(),
      submittedExpectedCash: row.expectedCash,
      cashReceived: null,
      confirmedById: null,
      confirmedAt: null,
      note: '',
    })
    commit()
    audit(
      staff,
      'remittance.submit',
      'remittance',
      null,
      `Submitted ${formatNaira(row.expectedCash)} cash for ${day}`,
    )
    return HttpResponse.json(out.remittance(remittanceRow(staff, day)), { status: 201 })
  }),
]
