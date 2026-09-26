import { delay, http, HttpResponse } from 'msw'
import { todayIso } from '@/lib/dates'
import { reportByKey } from '@/lib/reportCatalogue'
import { dashboard, officerPerformance } from '../analytics'
import { DomainError } from '../domain'
import { runReport } from '../reports'
import type { StaffRecord } from '../seed/generate'
import {
  api,
  authenticate,
  badRequest,
  can,
  forbidden,
  notFound,
  param,
  serialize,
  validationError,
} from '../utils'

/** Branch-level staff always see their own branch; head office may pick one or see all. */
function branchScope(staff: StaffRecord, requested: string | null): string | null {
  if (staff.role === 'account_officer') return staff.branchId
  return can(staff, 'branches.all') ? requested || null : staff.branchId
}

export const insightHandlers = [
  http.get(api('/dashboard/'), async ({ request }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'dashboard.view')) return forbidden()
    const branchId = branchScope(staff, param(request, 'branch'))
    return HttpResponse.json(serialize(dashboard({ branchId }, staff)))
  }),

  http.get(api('/field/performance/'), async ({ request }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'field.collect')) return forbidden()
    return HttpResponse.json(serialize(officerPerformance(staff)))
  }),

  http.get(api('/reports/:key/'), async ({ request, params }) => {
    await delay(400)
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    const key = String(params.key)
    const def = reportByKey(key)
    if (!def) return notFound()
    // Statements are also available to anyone who can see accounts.
    if (!can(staff, 'reports.view') && !(key === 'statement' && can(staff, 'accounts.view')))
      return forbidden()
    const today = todayIso()
    const from = param(request, 'date_from') ?? `${today.slice(0, 8)}01`
    const to = param(request, 'date_to') ?? today
    if (from > to) return validationError({ dateTo: ['The end date is before the start date.'] })
    try {
      const result = runReport(key, {
        branchId: branchScope(staff, param(request, 'branch')),
        officerId: param(request, 'officer'),
        from,
        to,
        accountNumber: param(request, 'account_number'),
        minDays: Math.max(1, Number(param(request, 'min_days') ?? 30) || 30),
      })
      return HttpResponse.json(serialize(result))
    } catch (e) {
      if (e instanceof DomainError)
        return e.field ? validationError({ [e.field]: [e.message] }) : badRequest(e.message)
      throw e
    }
  }),
]
