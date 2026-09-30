import { delay, http, HttpResponse } from 'msw'
import { todayIso } from '@/lib/dates'
import { formatNaira, naira } from '@/lib/money'
import type { CommissionRule, SavingsTarget, ThriftPlan } from '@/types'
import { commit, db } from '../db'
import { audit, DomainError, newId, openAccount, requestApproval } from '../domain'
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

function findAccount(request: Request, id: unknown) {
  const staff = authenticate(request)
  if (staff instanceof Response) return { error: staff }
  const account = db().accounts.find((a) => a.id === id)
  if (!account || !inScope(staff, account)) return { error: notFound() }
  return { staff, account }
}

const reasonOf = (body: { reason?: unknown }) =>
  typeof body.reason === 'string' ? body.reason.trim() : ''

export const accountHandlers = [
  http.get(api('/accounts/'), async ({ request }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'accounts.view')) return forbidden()
    let rows = scopeRows(staff, db().accounts)
    const filters = {
      customer: 'customerId',
      branch: 'branchId',
      officer: 'officerId',
      type: 'type',
      status: 'status',
    } as const
    for (const [key, field] of Object.entries(filters)) {
      const value = param(request, key)
      if (value) rows = rows.filter((a) => a[field] === value)
    }
    rows = filterBySearch(rows, param(request, 'search'), [
      (a) => a.accountNumber,
      (a) => a.customerName,
    ])
    rows = applyOrdering(rows, param(request, 'ordering') ?? 'account_number', [
      'account_number',
      'customer_name',
      'balance',
      'opened_at',
      'last_transaction_at',
      'type',
      'status',
    ])
    return paginate(request, rows, out.account)
  }),

  http.get(api('/accounts/:id/'), async ({ request, params }) => {
    await delay()
    const found = findAccount(request, params.id)
    if (found.error) return found.error
    return HttpResponse.json(out.account(found.account))
  }),

  http.post(api('/accounts/'), async ({ request }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'accounts.open')) return forbidden()
    const body = await readBody<{
      customerId: string
      type: string
      thriftPlanId: string | null
      target?: {
        goalName?: unknown
        targetAmount?: unknown
        targetDate?: unknown
        lockUntilReached?: unknown
      }
    }>(request)
    const customer = db().customers.find((c) => c.id === body.customerId)
    if (!customer || !inScope(staff, customer))
      return validationError({ customerId: ['Choose a customer.'] })
    if (customer.status !== 'active') {
      return badRequest(
        `Accounts can only be opened for active customers. This customer is ${customer.status.replace('_', ' ')}.`,
      )
    }
    if (body.type !== 'savings' && body.type !== 'target' && body.type !== 'thrift') {
      return validationError({
        type: [
          'Choose savings, target savings or thrift. Loan accounts are opened when a loan is disbursed.',
        ],
      })
    }
    let target: SavingsTarget | null = null
    if (body.type === 'savings') {
      const existing = db().accounts.find(
        (a) => a.customerId === customer.id && a.type === 'savings' && a.status !== 'closed',
      )
      if (existing)
        return validationError({
          type: [`This customer already has savings account ${existing.accountNumber}.`],
        })
    } else if (body.type === 'target') {
      const errors: Record<string, string[]> = {}
      const goalName = typeof body.target?.goalName === 'string' ? body.target.goalName.trim() : ''
      if (goalName.length < 3) errors['target.goalName'] = ['Say what the customer is saving for.']
      if (goalName.length > 60)
        errors['target.goalName'] = ['Keep the goal name under 60 characters.']
      const targetAmount = parseMoney(body.target?.targetAmount)
      if (!targetAmount)
        errors['target.targetAmount'] = ['Enter the amount the customer wants to save.']
      const targetDate = typeof body.target?.targetDate === 'string' ? body.target.targetDate : ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || Number.isNaN(Date.parse(targetDate)))
        errors['target.targetDate'] = ['Choose the date the customer wants to reach the goal.']
      else if (targetDate <= todayIso())
        errors['target.targetDate'] = ['The target date must be in the future.']
      if (Object.keys(errors).length) return validationError(errors)
      target = {
        goalName,
        targetAmount: targetAmount!,
        targetDate,
        lockUntilReached: body.target?.lockUntilReached === true,
      }
    } else {
      const plan = db().thriftPlans.find((p) => p.id === body.thriftPlanId)
      if (!plan || plan.status !== 'active')
        return validationError({ thriftPlanId: ['Choose an active thrift plan.'] })
    }
    try {
      const account = openAccount(customer.id, body.type, body.thriftPlanId ?? null, target)
      audit(
        staff,
        'account.open',
        'account',
        account.id,
        `Opened ${account.type} account ${account.accountNumber} for ${account.customerName}${target ? ` (goal: ${target.goalName}, ${formatNaira(target.targetAmount)} by ${target.targetDate})` : ''}`,
      )
      return HttpResponse.json(out.account(account), { status: 201 })
    } catch (e) {
      if (e instanceof DomainError)
        return e.field ? validationError({ [e.field]: [e.message] }) : badRequest(e.message)
      throw e
    }
  }),

  http.post(api('/accounts/:id/freeze/'), async ({ request, params }) => {
    await delay()
    const found = findAccount(request, params.id)
    if (found.error) return found.error
    const { staff, account } = found
    if (!can(staff, 'accounts.freeze')) return forbidden()
    const reason = reasonOf(await readBody(request))
    if (reason.length < 10)
      return validationError({
        reason: ['Say why the account is being frozen (at least 10 characters).'],
      })
    if (account.status === 'frozen') return conflict('This account is already frozen.')
    if (account.status === 'closed') return badRequest('Closed accounts cannot be frozen.')
    account.status = 'frozen'
    commit()
    audit(
      staff,
      'account.freeze',
      'account',
      account.id,
      `Froze ${account.accountNumber}: ${reason}`,
    )
    return HttpResponse.json(out.account(account))
  }),

  http.post(api('/accounts/:id/unfreeze/'), async ({ request, params }) => {
    await delay()
    const found = findAccount(request, params.id)
    if (found.error) return found.error
    const { staff, account } = found
    if (!can(staff, 'accounts.freeze')) return forbidden()
    if (account.status !== 'frozen') return conflict('This account is not frozen.')
    account.status = 'active'
    commit()
    audit(staff, 'account.unfreeze', 'account', account.id, `Unfroze ${account.accountNumber}`)
    return HttpResponse.json(out.account(account))
  }),

  http.post(api('/accounts/:id/reactivate/'), async ({ request, params }) => {
    await delay()
    const found = findAccount(request, params.id)
    if (found.error) return found.error
    const { staff, account } = found
    if (!can(staff, 'accounts.freeze')) return forbidden()
    if (account.status !== 'dormant') return conflict('Only dormant accounts can be reactivated.')
    account.status = 'active'
    commit()
    audit(
      staff,
      'account.reactivate',
      'account',
      account.id,
      `Reactivated dormant account ${account.accountNumber}`,
    )
    return HttpResponse.json(out.account(account))
  }),

  http.post(api('/accounts/:id/closure-request/'), async ({ request, params }) => {
    await delay()
    const found = findAccount(request, params.id)
    if (found.error) return found.error
    const { staff, account } = found
    if (!can(staff, 'accounts.request_close')) return forbidden()
    const reason = reasonOf(await readBody(request))
    if (reason.length < 10)
      return validationError({
        reason: ['Say why the account should be closed (at least 10 characters).'],
      })
    if (account.status === 'closed') return conflict('This account is already closed.')
    if (account.balance !== 0) {
      return badRequest(
        account.type === 'loan'
          ? `The loan still has ${formatNaira(account.balance)} outstanding. It closes by itself when fully repaid.`
          : `Withdraw or pay out the ${formatNaira(account.balance)} balance first, then request closure.`,
      )
    }
    if (
      db().approvals.some(
        (a) => a.accountId === account.id && a.type === 'account_closure' && a.status === 'pending',
      )
    ) {
      return conflict('A closure request for this account is already waiting for approval.')
    }
    try {
      const approval = requestApproval(staff, {
        type: 'account_closure',
        subject: `Close ${account.type} account ${account.accountNumber} for ${account.customerName}`,
        branchId: account.branchId,
        customerId: account.customerId,
        customerName: account.customerName,
        accountId: account.id,
        reason,
      })
      return HttpResponse.json(out.approval(approval), { status: 201 })
    } catch (e) {
      if (e instanceof DomainError) return badRequest(e.message)
      throw e
    }
  }),

  // ── Thrift plans ───────────────────────────────────────────────────────
  http.get(api('/thrift-plans/'), async ({ request }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'thrift_plans.view')) return forbidden()
    let rows = db().thriftPlans
    const status = param(request, 'status')
    if (status) rows = rows.filter((p) => p.status === status)
    return paginate(request, rows, out.thriftPlan)
  }),

  http.post(api('/thrift-plans/'), async ({ request }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'thrift_plans.manage')) return forbidden()
    const result = validatePlan(await readBody(request), null)
    if ('errors' in result) return validationError(result.errors)
    const codes = db().thriftPlans.map((p) => Number(p.code))
    const plan: ThriftPlan = {
      id: newId(),
      code: String(Math.max(20, ...codes) + 1),
      ...result.plan,
    }
    db().thriftPlans.push(plan)
    commit()
    audit(staff, 'thrift_plan.create', 'thrift_plan', plan.id, `Created thrift plan ${plan.name}`)
    return HttpResponse.json(out.thriftPlan(plan), { status: 201 })
  }),

  http.patch(api('/thrift-plans/:id/'), async ({ request, params }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'thrift_plans.manage')) return forbidden()
    const plan = db().thriftPlans.find((p) => p.id === params.id)
    if (!plan) return notFound()
    const result = validatePlan({ ...(await readBody(request)) }, plan)
    if ('errors' in result) return validationError(result.errors)
    Object.assign(plan, result.plan)
    // Keep account labels in step with a renamed plan.
    for (const a of db().accounts) if (a.productId === plan.id) a.productName = plan.name
    commit()
    audit(staff, 'thrift_plan.update', 'thrift_plan', plan.id, `Updated thrift plan ${plan.name}`)
    return HttpResponse.json(out.thriftPlan(plan))
  }),
]

type PlanBody = Record<string, unknown> & { commission?: Record<string, unknown> }

function validatePlan(
  body: PlanBody,
  existing: ThriftPlan | null,
): { plan: Omit<ThriftPlan, 'id' | 'code'> } | { errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {}
  const pick = <K extends keyof ThriftPlan>(key: K) =>
    (key in body ? body[key] : existing?.[key]) as unknown
  const name = String(pick('name') ?? '').trim()
  if (!name) errors.name = ['Enter a plan name customers will recognise, like "Daily ₦1,000".']
  else if (
    db().thriftPlans.some(
      (p) => p.name.toLowerCase() === name.toLowerCase() && p.id !== existing?.id,
    )
  ) {
    errors.name = ['Another plan already has this name.']
  }
  const frequency = pick('frequency')
  if (frequency !== 'daily' && frequency !== 'weekly')
    errors.frequency = ['Choose daily or weekly.']
  const rawAmount = pick('contributionAmount')
  const amount = typeof rawAmount === 'number' ? rawAmount : parseMoney(rawAmount)
  if (!amount) errors.contributionAmount = ['Enter the contribution amount.']
  else if (amount < naira(50)) errors.contributionAmount = ['The smallest contribution is ₦50.']
  const cycleLength = Number(pick('cycleLength'))
  if (!Number.isInteger(cycleLength) || cycleLength < 1 || cycleLength > 366) {
    errors.cycleLength = ['Enter a whole number of contributions between 1 and 366.']
  }
  const allowedMisses = Number(pick('allowedMisses') ?? 0)
  if (!Number.isInteger(allowedMisses) || allowedMisses < 0)
    errors.allowedMisses = ['Enter 0 or more.']

  const rawCommission = (body.commission ?? existing?.commission) as
    Record<string, unknown> | undefined
  let commission: CommissionRule = { type: 'first_contribution' }
  if (rawCommission?.type === 'percentage') {
    const percent = Number(rawCommission.percent)
    if (!(percent > 0 && percent <= 20))
      errors['commission.percent'] = ['Enter a percentage between 0 and 20.']
    commission = { type: 'percentage', percent: percent.toFixed(2) }
  } else if (rawCommission?.type === 'flat') {
    const flat =
      typeof rawCommission.amount === 'number'
        ? rawCommission.amount
        : parseMoney(rawCommission.amount)
    if (!flat) errors['commission.amount'] = ['Enter the flat fee.']
    commission = { type: 'flat', amount: (flat ?? 0) as ThriftPlan['contributionAmount'] }
  } else if (rawCommission?.type !== 'first_contribution') {
    errors['commission.type'] = ['Choose how the commission is charged.']
  }
  const status = pick('status')
  if (status !== 'active' && status !== 'retired') errors.status = ['Choose active or retired.']

  if (Object.keys(errors).length) return { errors }
  return {
    plan: {
      name,
      frequency: frequency as ThriftPlan['frequency'],
      contributionAmount: amount as ThriftPlan['contributionAmount'],
      cycleLength,
      commission,
      allowedMisses,
      earlyWithdrawalAllowed: Boolean(pick('earlyWithdrawalAllowed')),
      status: status as ThriftPlan['status'],
    },
  }
}
