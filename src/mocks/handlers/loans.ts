import { delay, http, HttpResponse } from 'msw'
import { addDays, buildSchedule, processingFee } from '@/lib/loans'
import { toLagosIso, todayIso } from '@/lib/dates'
import { formatNaira, kobo, parseDecimal, toDecimal, ZERO, type Kobo } from '@/lib/money'
import type {
  Collateral,
  FeeRule,
  LoanApplicationInput,
  LoanProduct,
  PaymentMethod,
  PenaltyRule,
} from '@/types'
import { commit, db } from '../db'
import {
  audit,
  calendar,
  current,
  DomainError,
  disburseLoan,
  newId,
  post,
  productOf,
  requestApproval,
  staffName,
} from '../domain'
import { scheduleWithStatus, type LoanRecord } from '../loanState'
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

const EXPIRY_WINDOW_DAYS = 14

function findLoan(request: Request, id: unknown) {
  const staff = authenticate(request)
  if (staff instanceof Response) return { error: staff }
  const loan = db().loans.find((l) => l.id === id)
  if (!loan || !inScope(staff, loan)) return { error: notFound() }
  return { staff, loan: current(loan) }
}

export const loanHandlers = [
  // ── Loan products ──────────────────────────────────────────────────────
  http.get(api('/loan-products/'), async ({ request }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'loan_products.view') && !can(staff, 'loans.view')) return forbidden()
    const status = param(request, 'status')
    const rows = db().loanProducts.filter((p) => !status || p.status === status)
    return paginate(request, rows, out.loanProduct)
  }),

  http.post(api('/loan-products/'), async ({ request }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'loan_products.manage')) return forbidden()
    const result = validateProduct(await readBody(request), null)
    if ('errors' in result) return validationError(result.errors)
    const codes = db().loanProducts.map((p) => Number(p.code))
    const product: LoanProduct = {
      id: newId(),
      code: String(Math.max(30, ...codes) + 1),
      ...result.product,
    }
    db().loanProducts.push(product)
    commit()
    audit(
      staff,
      'loan_product.create',
      'loan_product',
      product.id,
      `Created loan product ${product.name}`,
    )
    return HttpResponse.json(out.loanProduct(product), { status: 201 })
  }),

  http.patch(api('/loan-products/:id/'), async ({ request, params }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'loan_products.manage')) return forbidden()
    const product = db().loanProducts.find((p) => p.id === params.id)
    if (!product) return notFound()
    const result = validateProduct(await readBody(request), product)
    if ('errors' in result) return validationError(result.errors)
    Object.assign(product, result.product)
    commit()
    audit(
      staff,
      'loan_product.update',
      'loan_product',
      product.id,
      `Updated loan product ${product.name}. Existing loans keep their terms.`,
    )
    return HttpResponse.json(out.loanProduct(product))
  }),

  // ── Loans ──────────────────────────────────────────────────────────────
  http.get(api('/loans/'), async ({ request }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'loans.view') && !can(staff, 'accounts.view')) return forbidden()
    let rows = scopeRows(staff, db().loans).map(current)
    const filters = {
      customer: 'customerId',
      account: 'accountId',
      branch: 'branchId',
      officer: 'officerId',
      product: 'productId',
      status: 'status',
    } as const
    for (const [key, field] of Object.entries(filters)) {
      const value = param(request, key)
      if (value) rows = rows.filter((l) => l[field] === value)
    }
    const view = param(request, 'view')
    const today = todayIso()
    if (view === 'arrears') rows = rows.filter((l) => l.status === 'active' && l.arrears > 0)
    if (view === 'expiring') {
      const horizon = addDays(today, EXPIRY_WINDOW_DAYS)
      rows = rows.filter(
        (l) => l.status === 'active' && l.maturityDate !== null && l.maturityDate <= horizon,
      )
    }
    rows = filterBySearch(rows, param(request, 'search'), [
      (l) => l.loanNumber,
      (l) => l.customerName,
      (l) => l.accountNumber,
    ])
    rows = applyOrdering(rows, param(request, 'ordering') ?? '-created_at', [
      'created_at',
      'principal',
      'outstanding',
      'arrears',
      'days_in_arrears',
      'maturity_date',
      'customer_name',
    ])
    return paginate(request, rows, out.loan)
  }),

  http.get(api('/loans/:id/'), async ({ request, params }) => {
    await delay()
    const found = findLoan(request, params.id)
    if (found.error) return found.error
    const { loan } = found
    return HttpResponse.json(
      out.loanDetail(loan, scheduleWithStatus(loan, productOf(loan), todayIso())),
    )
  }),

  http.post(api('/loans/'), async ({ request }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'loans.apply')) return forbidden()
    const body = await readBody<
      LoanApplicationInput & {
        principal: string
        collateral: (Omit<Collateral, 'estimatedValue'> & { estimatedValue: string })[]
      }
    >(request)
    const errors: Record<string, string[]> = {}

    const customer = db().customers.find((c) => c.id === body.customerId)
    if (!customer || !inScope(staff, customer))
      return validationError({ customerId: ['Choose the customer.'] })
    if (customer.status !== 'active')
      errors.customerId = [`${customer.firstName} ${customer.lastName} is not an active customer.`]
    if (!customer.bvn) errors.customerId = ['Add the customer’s BVN before applying for a loan.']
    else if (!customer.nextOfKin)
      errors.customerId = ['Add a next of kin for this customer before applying for a loan.']

    const product = db().loanProducts.find((p) => p.id === body.productId)
    if (!product || product.status !== 'active')
      errors.productId = ['Choose an active loan product.']

    const principal = parseMoney(body.principal)
    if (!principal) errors.principal = ['Enter the loan amount.']
    else if (product && (principal < product.minAmount || principal > product.maxAmount)) {
      errors.principal = [
        `${product.name} lends between ${formatNaira(product.minAmount, { trimZeroKobo: true })} and ${formatNaira(product.maxAmount, { trimZeroKobo: true })}.`,
      ]
    }
    const count = Number(body.installmentCount)
    if (
      product &&
      (!Number.isInteger(count) || count < product.minTenor || count > product.maxTenor)
    ) {
      errors.installmentCount = [
        `Choose between ${product.minTenor} and ${product.maxTenor} installments.`,
      ]
    }
    if (product?.requiresGuarantor && customer && customer.guarantors.length === 0) {
      errors.customerId = [
        'This product needs at least one guarantor. Add one on the customer’s page first.',
      ]
    }
    const isBnpl = product?.kind === 'bnpl'
    const itemDescription =
      typeof body.itemDescription === 'string' ? body.itemDescription.trim() : ''
    const supplierName = typeof body.supplierName === 'string' ? body.supplierName.trim() : ''
    let purpose = typeof body.purpose === 'string' ? body.purpose.trim() : ''
    if (isBnpl) {
      if (itemDescription.length < 3) errors.itemDescription = ['Say what the company is buying.']
      if (supplierName.length < 2) errors.supplierName = ['Enter who the company will pay.']
      purpose = itemDescription
    } else if (purpose.length < 5) errors.purpose = ['Say what the money is for.']

    const collateral: Collateral[] = []
    ;(body.collateral ?? []).forEach((c, i) => {
      const value = parseMoney(c.estimatedValue)
      if (!c.description?.trim()) errors[`collateral.${i}.description`] = ['Describe the item.']
      if (!value) errors[`collateral.${i}.estimatedValue`] = ['Enter what it is worth.']
      collateral.push({
        description: c.description?.trim() ?? '',
        estimatedValue: value ?? ZERO,
        documentRef: c.documentRef?.trim() ?? '',
      })
    })

    const topUpOf = body.topUpOfId ? db().loans.find((l) => l.id === body.topUpOfId) : undefined
    if (body.topUpOfId && (isBnpl || topUpOf?.kind === 'bnpl')) {
      errors.topUpOfId = ['Top-ups are only available for cash loans.']
    } else if (
      body.topUpOfId &&
      (!topUpOf || topUpOf.customerId !== customer.id || topUpOf.status !== 'active')
    ) {
      errors.topUpOfId = ['Top-ups can only replace this customer’s active loan.']
    }
    const existing = db().loans.find(
      (l) =>
        l.customerId === customer.id &&
        ['active', 'approved', 'pending_approval'].includes(l.status) &&
        l.id !== topUpOf?.id,
    )
    if (existing) {
      errors.customerId = [
        existing.status === 'active'
          ? `${customer.firstName} already has active loan ${existing.loanNumber}. Apply for a top-up of that loan instead.`
          : `${customer.firstName} already has loan ${existing.loanNumber} waiting to be ${existing.status === 'approved' ? 'paid out' : 'approved'}.`,
      ]
    }
    if (topUpOf && principal && product) {
      const settle = current(topUpOf).outstanding
      const fee = processingFee(principal, product.processingFee)
      if (principal - fee - settle <= 0) {
        errors.principal = [
          `The old loan still has ${formatNaira(settle)} to pay. The top-up must be larger than that plus the fee.`,
        ]
      }
    }
    if (Object.keys(errors).length || !product || !principal) return validationError(errors)

    const branch = db().branches.find((b) => b.id === customer.branchId)!
    const quote = buildSchedule(
      {
        principal,
        ratePercent: product.ratePercent,
        interestBasis: product.interestBasis,
        interestMethod: product.interestMethod,
        frequency: product.repaymentFrequency,
        installmentCount: count,
      },
      todayIso(),
      calendar(),
    )
    const serial = Math.max(0, ...db().loans.map((l) => Number(l.loanNumber.slice(4)))) + 1
    const loan: LoanRecord = {
      id: newId(),
      loanNumber: `LN${branch.code}${String(serial).padStart(6, '0')}`,
      accountId: null,
      accountNumber: null,
      customerId: customer.id,
      customerName: `${customer.firstName} ${customer.lastName}`,
      productId: product.id,
      productName: product.name,
      branchId: customer.branchId,
      officerId: customer.officerId,
      principal,
      interest: quote.interest,
      totalRepayable: quote.totalRepayable,
      amountPaid: ZERO,
      outstanding: ZERO,
      arrears: ZERO,
      penaltyAccrued: ZERO,
      daysInArrears: 0,
      frequency: product.repaymentFrequency,
      installmentAmount: quote.installment,
      installmentCount: count,
      kind: product.kind,
      interestMethod: product.interestMethod,
      interestBasis: product.interestBasis,
      ratePercent: product.ratePercent,
      processingFee: processingFee(principal, product.processingFee),
      itemDescription: isBnpl ? itemDescription : null,
      supplierName: isBnpl ? supplierName : null,
      penaltiesCharged: ZERO,
      status: 'pending_approval',
      purpose,
      guarantors: [...customer.guarantors],
      collateral,
      topUpOfId: topUpOf?.id ?? null,
      topUpOfNumber: topUpOf?.loanNumber ?? null,
      extensions: 0,
      nextDueDate: null,
      nextDueAmount: null,
      appliedByName: staffName(staff),
      approvedByName: null,
      disbursedByName: null,
      disbursedAt: null,
      maturityDate: null,
      closedAt: null,
      createdAt: toLagosIso(),
      schedule: quote.rows,
    }
    db().loans.unshift(loan)
    try {
      // The MD and general managers approve loans for everyone else, so theirs are approved straight away.
      requestApproval(staff, {
        type: 'loan_application',
        subject: `${topUpOf ? 'Top-up' : isBnpl ? 'Buy now pay later purchase' : 'Loan'} of ${formatNaira(principal, { trimZeroKobo: true })} for ${loan.customerName} (${product.name})`,
        amount: principal,
        branchId: loan.branchId,
        customerId: customer.id,
        customerName: loan.customerName,
        loanId: loan.id,
        reason: purpose,
      })
    } catch (e) {
      db().loans.splice(db().loans.indexOf(loan), 1)
      if (e instanceof DomainError) return badRequest(e.message)
      throw e
    }
    audit(
      staff,
      'loan.apply',
      'loan',
      loan.id,
      `Applied for ${loan.loanNumber}: ${formatNaira(principal)} over ${count} ${product.repaymentFrequency} installments`,
    )
    return HttpResponse.json(out.loan(current(loan)), { status: 201 })
  }),

  http.post(api('/loans/:id/disburse/'), async ({ request, params }) => {
    await delay()
    const found = findLoan(request, params.id)
    if (found.error) return found.error
    const { staff, loan } = found
    if (!can(staff, 'loans.disburse')) return forbidden()
    const body = await readBody<{ paymentMethod: PaymentMethod }>(request)
    try {
      const payout = disburseLoan(loan, staff, body.paymentMethod === 'cash' ? 'cash' : 'transfer')
      audit(
        staff,
        'loan.disburse',
        'loan',
        loan.id,
        `Paid out ${formatNaira(payout)} for ${loan.loanNumber} by ${body.paymentMethod === 'cash' ? 'cash' : 'transfer'}`,
      )
      return HttpResponse.json(
        { loan: out.loan(current(loan)), payout: toDecimal(payout) },
        { status: 200 },
      )
    } catch (e) {
      if (e instanceof DomainError) return badRequest(e.message)
      throw e
    }
  }),

  http.post(api('/loans/:id/extension-request/'), async ({ request, params }) => {
    await delay()
    const found = findLoan(request, params.id)
    if (found.error) return found.error
    const { staff, loan } = found
    if (!can(staff, 'loans.apply')) return forbidden()
    if (loan.status !== 'active') return badRequest('Only active loans can be extended.')
    if (
      db().approvals.some(
        (a) => a.loanId === loan.id && a.type === 'loan_extension' && a.status === 'pending',
      )
    ) {
      return conflict('An extension for this loan is already waiting for approval.')
    }
    const body = await readBody<{ extraInstallments: number; reason: string }>(request)
    const extra = Number(body.extraInstallments)
    const errors: Record<string, string[]> = {}
    const max = Math.max(1, Math.round(loan.installmentCount / 2))
    if (!Number.isInteger(extra) || extra < 1 || extra > max)
      errors.extraInstallments = [`Add between 1 and ${max} installments.`]
    const reason = (body.reason ?? '').trim()
    if (reason.length < 10)
      errors.reason = ['Explain why the customer needs more time (at least 10 characters).']
    if (Object.keys(errors).length) return validationError(errors)
    try {
      const approval = requestApproval(staff, {
        type: 'loan_extension',
        subject: `Extend ${loan.loanNumber} for ${loan.customerName} by ${extra} ${loan.frequency} installments`,
        amount: loan.outstanding,
        branchId: loan.branchId,
        customerId: loan.customerId,
        customerName: loan.customerName,
        accountId: loan.accountId,
        loanId: loan.id,
        reason,
        payload: { extraInstallments: extra },
      })
      return HttpResponse.json(out.approval(approval), { status: 201 })
    } catch (e) {
      if (e instanceof DomainError) return badRequest(e.message)
      throw e
    }
  }),

  http.post(api('/loans/:id/charge-penalty/'), async ({ request, params }) => {
    await delay()
    const found = findLoan(request, params.id)
    if (found.error) return found.error
    const { staff, loan } = found
    if (!can(staff, 'loans.approve')) return forbidden()
    if (loan.status !== 'active' || !loan.accountId)
      return badRequest('Penalties can only be charged on active loans.')
    if (loan.penaltyAccrued <= 0) return badRequest('No penalty has built up on this loan.')
    const account = db().accounts.find((a) => a.id === loan.accountId)!
    const amount = loan.penaltyAccrued
    post({
      account,
      type: 'penalty',
      direction: 'debit',
      amount,
      channel: 'system',
      postedBy: staff,
      paymentMethod: null,
      narration: `Late payment penalty: ${loan.daysInArrears} days in arrears`,
    })
    audit(
      staff,
      'loan.penalty',
      'loan',
      loan.id,
      `Charged ${formatNaira(amount)} penalty on ${loan.loanNumber}`,
    )
    return HttpResponse.json(out.loan(current(loan)))
  }),
]

type ProductBody = Record<string, unknown> & { penalty?: Record<string, unknown> }

function validateProduct(
  body: ProductBody,
  existing: LoanProduct | null,
): { product: Omit<LoanProduct, 'id' | 'code'> } | { errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {}
  const pick = <K extends keyof LoanProduct>(key: K) =>
    (key in body ? body[key] : existing?.[key]) as unknown
  const money = (v: unknown): Kobo | null => {
    if (typeof v === 'number') return kobo(v)
    try {
      return typeof v === 'string' ? parseDecimal(v) : null
    } catch {
      return null
    }
  }
  const percent = (v: unknown, field: string, max: number) => {
    const n = Number(v)
    if (!(n >= 0 && n <= max)) errors[field] = [`Enter a percentage between 0 and ${max}.`]
    return Number.isFinite(n) ? n.toFixed(2) : '0.00'
  }
  const amount = (v: unknown, field: string): Kobo => {
    const k = money(v)
    if (k === null || k <= 0) {
      errors[field] = ['Enter an amount greater than zero.']
      return kobo(0)
    }
    return k
  }

  const name = String(pick('name') ?? '').trim()
  if (!name) errors.name = ['Enter a product name.']
  else if (
    db().loanProducts.some(
      (p) => p.name.toLowerCase() === name.toLowerCase() && p.id !== existing?.id,
    )
  ) {
    errors.name = ['Another product already has this name.']
  }
  const kind = pick('kind')
  if (kind !== 'cash' && kind !== 'bnpl') errors.kind = ['Choose cash loan or buy now pay later.']
  const interestBasis = pick('interestBasis')
  if (interestBasis !== 'monthly' && interestBasis !== 'overall')
    errors.interestBasis = ['Choose whether the rate is monthly or overall.']
  let interestMethod = pick('interestMethod')
  // An overall rate is one charge on the amount, so it is always flat.
  if (interestBasis === 'overall') interestMethod = 'flat'
  if (interestMethod !== 'flat' && interestMethod !== 'reducing_balance')
    errors.interestMethod = ['Choose flat or reducing balance.']
  const frequency = pick('repaymentFrequency')
  if (frequency !== 'daily' && frequency !== 'weekly' && frequency !== 'monthly')
    errors.repaymentFrequency = ['Choose how often customers repay.']
  const rate = percent(pick('ratePercent'), 'ratePercent', interestBasis === 'overall' ? 100 : 30)
  const rawFee = (pick('processingFee') ?? { type: 'none' }) as Record<string, unknown>
  let processingFee: FeeRule = { type: 'none' }
  if (rawFee.type === 'percentage')
    processingFee = {
      type: 'percentage',
      percent: percent(rawFee.percent, 'processingFee.percent', 20),
    }
  else if (rawFee.type === 'flat')
    processingFee = { type: 'flat', amount: amount(rawFee.amount, 'processingFee.amount') }
  else if (rawFee.type !== 'none') errors.processingFee = ['Choose percentage, flat fee or none.']
  const minTenor = Number(pick('minTenor'))
  const maxTenor = Number(pick('maxTenor'))
  if (!Number.isInteger(minTenor) || minTenor < 1)
    errors.minTenor = ['Enter a whole number of installments.']
  if (!Number.isInteger(maxTenor) || maxTenor < minTenor)
    errors.maxTenor = ['Must be at least the shortest tenor.']
  const minAmount = money(pick('minAmount'))
  const maxAmount = money(pick('maxAmount'))
  if (!minAmount || minAmount <= 0) errors.minAmount = ['Enter the smallest amount.']
  if (!maxAmount || (minAmount && maxAmount < minAmount))
    errors.maxAmount = ['Must be at least the smallest amount.']
  const rawPenalty = (body.penalty ?? existing?.penalty ?? {}) as Record<string, unknown>
  const graceDays = Number(rawPenalty.graceDays)
  if (!Number.isInteger(graceDays) || graceDays < 0)
    errors['penalty.graceDays'] = ['Enter 0 or more days.']
  const capPercent = percent(rawPenalty.capPercent, 'penalty.capPercent', 100)
  let penalty: PenaltyRule
  if (rawPenalty.type === 'flat') {
    penalty = {
      type: 'flat',
      amountPerDay: amount(rawPenalty.amountPerDay, 'penalty.amountPerDay'),
      graceDays,
      capPercent,
    }
  } else {
    if (rawPenalty.type !== 'percentage')
      errors['penalty.type'] = ['Choose percentage or flat fee.']
    penalty = {
      type: 'percentage',
      percentPerDay: percent(rawPenalty.percentPerDay, 'penalty.percentPerDay', 5),
      graceDays,
      capPercent,
    }
  }
  const status = pick('status')
  if (status !== 'active' && status !== 'retired') errors.status = ['Choose active or retired.']
  if (Object.keys(errors).length) return { errors }
  return {
    product: {
      name,
      kind: kind as LoanProduct['kind'],
      interestMethod: interestMethod as LoanProduct['interestMethod'],
      interestBasis: interestBasis as LoanProduct['interestBasis'],
      ratePercent: rate,
      repaymentFrequency: frequency as LoanProduct['repaymentFrequency'],
      minTenor,
      maxTenor,
      minAmount: minAmount!,
      maxAmount: maxAmount!,
      processingFee,
      penalty,
      requiresGuarantor: Boolean(pick('requiresGuarantor')),
      status: status as LoanProduct['status'],
    },
  }
}
