import { delay, http } from 'msw'
import type { OfficerOption } from '@/types'
import { db } from '../db'
import { staffName } from '../domain'
import type { StaffRecord } from '../seed/generate'
import {
  api,
  applyOrdering,
  authenticate,
  can,
  effectivePermissions,
  filterBySearch,
  forbidden,
  paginate,
  param,
  serialize,
} from '../utils'

function publicStaff(record: StaffRecord) {
  const { password: _p, mustChangePassword: _m, ...rest } = record
  return serialize({ ...rest, permissions: effectivePermissions(record) })
}

export const organisationHandlers = [
  http.get(api('/branches/'), async ({ request }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    let rows = db().branches
    if (!can(staff, 'branches.all')) rows = rows.filter((b) => b.id === staff.branchId)
    rows = filterBySearch(rows, param(request, 'search'), [(b) => b.name, (b) => b.code])
    return paginate(
      request,
      applyOrdering(rows, param(request, 'ordering') ?? 'code', ['code', 'name']),
      (b) => serialize(b),
    )
  }),

  http.get(api('/staff/'), async ({ request }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'staff.view')) return forbidden()
    let rows = can(staff, 'branches.all')
      ? db().staff
      : db().staff.filter((s) => s.branchId === staff.branchId)
    const branch = param(request, 'branch')
    const role = param(request, 'role')
    const status = param(request, 'status')
    if (branch) rows = rows.filter((s) => s.branchId === branch)
    if (role) rows = rows.filter((s) => s.role === role)
    if (status) rows = rows.filter((s) => s.status === status)
    rows = filterBySearch(rows, param(request, 'search'), [
      (s) => staffName(s),
      (s) => s.email,
      (s) => s.staffId,
    ])
    rows = applyOrdering(rows, param(request, 'ordering') ?? 'last_name', [
      'last_name',
      'staff_id',
      'role',
      'branch_name',
      'last_login_at',
    ])
    return paginate(request, rows, publicStaff)
  }),

  // Officer picker for filters and assignment. Any back-office role may read it.
  http.get(api('/officers/'), async ({ request }) => {
    await delay(120)
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (staff.role === 'account_officer') return forbidden()
    const branch = param(request, 'branch')
    const rows: OfficerOption[] = db()
      .staff.filter((s) => s.role === 'account_officer')
      .filter((s) =>
        can(staff, 'branches.all')
          ? !branch || s.branchId === branch
          : s.branchId === staff.branchId,
      )
      .map((s) => ({
        id: s.id,
        name: staffName(s),
        branchId: s.branchId!,
        branchName: s.branchName ?? '',
        status: s.status,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return paginate(request, rows, (o) => serialize(o))
  }),
]
