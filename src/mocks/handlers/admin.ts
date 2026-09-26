import { delay, http, HttpResponse } from 'msw'
import { camelToSnake } from '@/lib/case'
import { toLagosIso } from '@/lib/dates'
import { formatNaira, parseDecimal } from '@/lib/money'
import {
  HEADQUARTERS_ROLES,
  PERMISSIONS,
  ROLE_LABELS,
  ROLES,
  type BusinessSettings,
  type Holiday,
  type Permission,
  type Role,
  type SmsTemplate,
} from '@/types'
import { normalisePhone } from '@/lib/phone'
import { PERMISSION_LABELS, roleWithArticle } from '@/lib/permissionCatalogue'
import { assignPermissions, grantablePermissions, ROLE_PERMISSIONS } from '@/lib/permissions'
import { commit, db, updateStaff } from '../db'
import { platform } from '../platform'
import { audit, lagosDay, newId, staffName } from '../domain'
import type { StaffRecord } from '../seed/generate'
import { out } from '../serializers'
import {
  api,
  applyOrdering,
  authenticate,
  badRequest,
  can,
  conflict,
  effectivePermissions,
  filterBySearch,
  forbidden,
  notFound,
  paginate,
  param,
  readBody,
  serialize,
  validationError,
} from '../utils'

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

function publicStaff(record: StaffRecord) {
  const { password: _p, ...rest } = record
  return serialize({ ...rest, permissions: effectivePermissions(record) })
}

/** Readable temporary password, e.g. "Ikola-482913". Shown once to the admin. */
function temporaryPassword(): string {
  const words = ['Egbeda', 'Ikotun', 'Ipaja', 'Igando', 'Ikola', 'Shasha', 'Ayobo', 'Baruwa']
  const [a = 0, b = 0] = crypto.getRandomValues(new Uint32Array(2))
  return `${words[a % words.length]}-${100_000 + (b % 900_000)}`
}

function validateStaff(body: Record<string, unknown>, existing: StaffRecord | null) {
  const errors: Record<string, string[]> = {}
  const pick = (k: keyof StaffRecord) => (k in body ? body[k] : existing?.[k])
  const firstName = text(pick('firstName'))
  const lastName = text(pick('lastName'))
  if (!firstName) errors.firstName = ['Enter the first name.']
  if (!lastName) errors.lastName = ['Enter the last name.']
  const email = text(pick('email')).toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    errors.email = ['Enter a valid email address. Staff sign in with it.']
  else if (db().staff.some((s) => s.email === email && s.id !== existing?.id))
    errors.email = ['Another staff member already uses this email.']
  const phone = normalisePhone(text(pick('phone')))
  if (!phone) errors.phone = ['Enter a Nigerian mobile number. Sign-in codes are sent to it.']
  const role = pick('role') as Role
  if (!ROLES.includes(role)) errors.role = ['Choose a role.']
  // Head-office roles always sit at headquarters; everyone else in an operational branch.
  const hq = db().branches.find((b) => b.kind === 'headquarters')
  const atHq = HEADQUARTERS_ROLES.includes(role)
  const requested = (pick('branchId') as string | null) || null
  const branchId = atHq ? (hq?.id ?? null) : requested
  if (!atHq && !db().branches.some((b) => b.id === branchId && b.kind === 'branch')) {
    errors.branchId = [
      'Choose the branch this person works in. Only the MD, general manager and administrators sit at headquarters.',
    ]
  }
  return {
    errors,
    clean: {
      firstName,
      lastName,
      email,
      phone: phone ?? '',
      role,
      branchId,
    },
  }
}

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const isPermission = (p: unknown): p is Permission =>
  typeof p === 'string' && (PERMISSIONS as readonly string[]).includes(p)

/**
 * Check and resolve the permissions being given to a staff member. They come from
 * what the role allows, and the person assigning them can only hand out what they
 * hold themselves. Without a permissions list, the person keeps what they have.
 */
function resolveStaffPermissions(
  body: Record<string, unknown>,
  role: Role,
  target: StaffRecord | null,
  assigner: StaffRecord,
  errors: Record<string, string[]>,
): Permission[] {
  const available = db().settings?.rolePermissions[role] ?? ROLE_PERMISSIONS[role] ?? []
  const existing = target?.permissions ?? []
  if (!('permissions' in body)) {
    return assignPermissions({ role, available, assigner: [], requested: [], existing })
  }
  const requested = Array.isArray(body.permissions) ? body.permissions.filter(isPermission) : []
  const mine = effectivePermissions(assigner)
  const grantable = grantablePermissions(mine, available)
  const notForRole = requested.filter((p) => !available.includes(p))
  const notMine = requested.filter(
    (p) => available.includes(p) && !grantable.includes(p) && !existing.includes(p),
  )
  const labels = (ps: Permission[]) => ps.map((p) => PERMISSION_LABELS[p]).join(', ')
  if (notForRole.length)
    errors.permissions = [
      `${upperFirst(roleWithArticle(role))} can’t have: ${labels(notForRole)}. Change what the role allows in Settings first.`,
    ]
  else if (notMine.length)
    errors.permissions = [`You can only give permissions you have. Remove: ${labels(notMine)}.`]
  const result = assignPermissions({ role, available, assigner: mine, requested, existing })
  if (!errors.permissions && result.length === 0)
    errors.permissions = ['Choose at least one permission.']
  return result
}

export const adminHandlers = [
  // ── Settings ───────────────────────────────────────────────────────────
  http.get(api('/settings/'), async ({ request }) => {
    await delay(150)
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    return HttpResponse.json(out.settings(db().settings))
  }),

  http.patch(api('/settings/'), async ({ request }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'settings.manage')) return forbidden()
    const body = await readBody<Record<string, unknown>>(request)
    const s = db().settings
    const errors: Record<string, string[]> = {}
    const next: Partial<BusinessSettings> = {}
    const changed: string[] = []

    for (const key of [
      'businessName',
      'address',
      'phone',
      'email',
      'registrationNumber',
    ] as const) {
      if (!(key in body)) continue
      const v = text(body[key])
      if (!v && key !== 'registrationNumber') errors[key] = ['This can’t be empty.']
      next[key] = v
      changed.push('business details')
    }
    if ('smsSenderId' in body) {
      const v = text(body.smsSenderId)
      if (!/^[A-Za-z0-9 ]{3,11}$/.test(v))
        errors.smsSenderId = ['Use 3 to 11 letters or numbers. Networks reject longer sender IDs.']
      next.smsSenderId = v
      changed.push('SMS sender ID')
    }
    if ('workingDays' in body) {
      const days = Array.isArray(body.workingDays)
        ? [...new Set(body.workingDays.map(Number))].filter((d) => d >= 0 && d <= 6).sort()
        : []
      if (days.length === 0) errors.workingDays = ['Choose at least one working day.']
      next.workingDays = days
      changed.push('working days')
    }
    if ('holidays' in body) {
      const list = (Array.isArray(body.holidays) ? body.holidays : []) as Holiday[]
      list.forEach((h, i) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(h.date)) errors[`holidays.${i}.date`] = ['Choose a date.']
        if (!text(h.name)) errors[`holidays.${i}.name`] = ['Name the holiday.']
      })
      const dates = list.map((h) => h.date)
      if (new Set(dates).size !== dates.length) errors.holidays = ['The same date is listed twice.']
      next.holidays = list
        .map((h) => ({ date: h.date, name: text(h.name) }))
        .sort((a, b) => a.date.localeCompare(b.date))
      changed.push('holidays')
    }
    if ('largeWithdrawalThreshold' in body) {
      try {
        const v = parseDecimal(String(body.largeWithdrawalThreshold))
        if (v <= 0) throw new Error()
        next.largeWithdrawalThreshold = v
        changed.push(`large-withdrawal limit (${formatNaira(v, { trimZeroKobo: true })})`)
      } catch {
        errors.largeWithdrawalThreshold = ['Enter an amount greater than ₦0.']
      }
    }
    for (const [key, min, max, label] of [
      ['reversalWindowDays', 1, 365, 'reversal window'],
      ['fieldSyncMaxAgeDays', 1, 14, 'field sync limit'],
    ] as const) {
      if (!(key in body)) continue
      const v = Number(body[key])
      if (!Number.isInteger(v) || v < min || v > max)
        errors[key] = [`Enter a whole number of days from ${min} to ${max}.`]
      next[key] = v
      changed.push(label)
    }
    if ('smsTemplates' in body) {
      const list = (Array.isArray(body.smsTemplates) ? body.smsTemplates : []) as Pick<
        SmsTemplate,
        'key' | 'body' | 'enabled'
      >[]
      const templates = s.smsTemplates.map((t) => {
        const update = list.find((u) => u.key === t.key)
        if (!update) return t
        const i = s.smsTemplates.indexOf(t)
        const bodyText = text(update.body)
        if (!bodyText) errors[`smsTemplates.${i}.body`] = ['The message can’t be empty.']
        const unknown = (bodyText.match(/\{[a-z_]+\}/g) ?? []).filter(
          (ph) => !t.placeholders.includes(ph),
        )
        if (unknown.length)
          errors[`smsTemplates.${i}.body`] = [
            `${unknown.join(', ')} can’t be used in this message. Use ${t.placeholders.join(', ')}.`,
          ]
        if (t.key === 'login_otp' && !bodyText.includes('{code}'))
          errors[`smsTemplates.${i}.body`] = ['The sign-in message must include {code}.']
        return {
          ...t,
          body: bodyText,
          enabled: t.key === 'login_otp' ? true : Boolean(update.enabled),
        }
      })
      next.smsTemplates = templates
      changed.push('SMS templates')
    }
    if ('rolePermissions' in body) {
      if (!can(staff, 'staff.permissions'))
        return forbidden('Only the managing director can change what each role allows.')
      // Role names arrive camelCased along with every other key; map them back.
      const raw = Object.fromEntries(
        Object.entries((body.rolePermissions ?? {}) as Record<string, string[]>).map(([k, v]) => [
          camelToSnake(k),
          v,
        ]),
      )
      const matrix = Object.fromEntries(
        ROLES.map((role) => [
          role,
          (raw[role] ?? []).filter((p): p is Permission =>
            (PERMISSIONS as readonly string[]).includes(p),
          ),
        ]),
      ) as Record<Role, Permission[]>
      // Protect against locking everyone out.
      matrix.md = PERMISSIONS.filter((p) => p !== 'field.collect')
      for (const p of ['settings.manage', 'staff.manage', 'staff.view'] as const)
        if (!matrix.admin.includes(p)) matrix.admin.push(p)
      if (!matrix.account_officer.includes('field.collect'))
        matrix.account_officer.push('field.collect')
      next.rolePermissions = matrix
      // Taking a permission away from a role takes it from everyone in that role.
      // Adding one gives it to nobody until it is assigned to each person.
      for (const person of db().staff)
        person.permissions = person.permissions.filter((p) => matrix[person.role].includes(p))
      changed.push('role permissions')
    }

    if (Object.keys(errors).length) return validationError(errors)
    Object.assign(s, next, { updatedAt: toLagosIso(), updatedByName: staffName(staff) })
    commit()
    audit(
      staff,
      'settings.update',
      'settings',
      null,
      `Changed ${[...new Set(changed)].join(', ') || 'settings'}`,
    )
    return HttpResponse.json(out.settings(s))
  }),

  // ── Audit log ──────────────────────────────────────────────────────────
  http.get(api('/audit/'), async ({ request }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'audit.view')) return forbidden()
    let rows = can(staff, 'branches.all')
      ? db().audit
      : db().audit.filter((a) => a.branchId === staff.branchId)
    const actor = param(request, 'actor')
    const action = param(request, 'action')
    const entity = param(request, 'entity_type')
    const branch = param(request, 'branch')
    const from = param(request, 'date_from')
    const to = param(request, 'date_to')
    if (actor) rows = rows.filter((a) => a.actorId === actor)
    if (action) rows = rows.filter((a) => a.action.startsWith(action))
    if (entity) rows = rows.filter((a) => a.entityType === entity)
    if (branch) rows = rows.filter((a) => a.branchId === branch)
    if (from) rows = rows.filter((a) => lagosDay(a.at) >= from)
    if (to) rows = rows.filter((a) => lagosDay(a.at) <= to)
    rows = filterBySearch(rows, param(request, 'search'), [
      (a) => a.summary,
      (a) => a.actorName,
      (a) => a.ipAddress,
    ])
    rows = applyOrdering(rows, param(request, 'ordering') ?? '-at', ['at', 'actor_name', 'action'])
    return paginate(request, rows, (a) => serialize(a))
  }),

  // ── Branches ───────────────────────────────────────────────────────────
  http.post(api('/branches/'), async ({ request }) => saveBranch(request, null)),
  http.patch(api('/branches/:id/'), async ({ request, params }) =>
    saveBranch(request, String(params.id)),
  ),

  // ── Staff ──────────────────────────────────────────────────────────────
  http.get(api('/staff/:id/'), async ({ request, params }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'staff.view')) return forbidden()
    const target = db().staff.find((s) => s.id === params.id)
    if (!target || (!can(staff, 'branches.all') && target.branchId !== staff.branchId))
      return notFound()
    return HttpResponse.json(publicStaff(target))
  }),

  http.post(api('/staff/'), async ({ request }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'staff.permissions'))
      return forbidden('Only the MD or general manager can add staff.')
    const body = await readBody(request)
    const { errors, clean } = validateStaff(body, null)
    if (clean.role === 'md' && staff.role !== 'md')
      errors.role = ['Only the managing director can add another managing director.']
    const permissions = resolveStaffPermissions(body, clean.role, null, staff, errors)
    if (Object.keys(errors).length) return validationError(errors)
    const serial = Math.max(0, ...db().staff.map((s) => Number(s.staffId.slice(4)))) + 1
    const password = temporaryPassword()
    const record: StaffRecord = {
      id: newId(),
      staffId: `EMS/${String(serial).padStart(4, '0')}`,
      ...clean,
      branchName: db().branches.find((b) => b.id === clean.branchId)?.name ?? null,
      status: 'active',
      permissions,
      lastLoginAt: null,
      createdAt: toLagosIso(),
      password: platform().hashPassword(password),
      mustChangePassword: true,
    }
    db().staff.push(record)
    const branch = db().branches.find((b) => b.id === record.branchId)
    if (branch) branch.staffCount += 1
    commit()
    audit(
      staff,
      'staff.create',
      'staff',
      record.id,
      `Added ${staffName(record)} (${record.staffId}) as ${ROLE_LABELS[record.role].toLowerCase()} with ${permissions.length} permissions`,
    )
    return HttpResponse.json(
      { staff: publicStaff(record), temporary_password: password },
      { status: 201 },
    )
  }),

  http.patch(api('/staff/:id/'), async ({ request, params }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    const target = db().staff.find((s) => s.id === params.id)
    if (!target) return notFound()
    const body = await readBody(request)
    const { errors, clean } = validateStaff(body, target)
    const detailsChanged = (['firstName', 'lastName', 'email', 'phone', 'branchId'] as const).some(
      (k) => k in body,
    )
    const roleChanged = clean.role !== target.role
    const accessChanged = 'permissions' in body || roleChanged
    if (detailsChanged && !can(staff, 'staff.manage')) return forbidden()
    if (accessChanged && !can(staff, 'staff.permissions'))
      return forbidden('Only the MD or general manager can change roles and permissions.')
    if ((target.role === 'md' || clean.role === 'md') && staff.role !== 'md')
      return forbidden('Only the managing director can change a managing director’s account.')
    if (target.id === staff.id && 'permissions' in body)
      errors.permissions = ['You can’t change your own permissions.']
    const permissions = resolveStaffPermissions(body, clean.role, target, staff, errors)
    if (target.role === 'account_officer' && clean.role !== 'account_officer') {
      const count = db().customers.filter(
        (c) => c.officerId === target.id && c.status !== 'inactive',
      ).length
      if (count > 0)
        errors.role = [
          `${staffName(target)} still has ${count} customers. Move them to another officer first.`,
        ]
    }
    if (target.id === staff.id && clean.role !== target.role)
      errors.role = ['You can’t change your own role.']
    if (Object.keys(errors).length) return validationError(errors)
    const moved = target.branchId !== clean.branchId
    const added = permissions.filter((p) => !target.permissions.includes(p))
    const removed = target.permissions.filter((p) => !permissions.includes(p))
    Object.assign(target, clean, {
      branchName: db().branches.find((b) => b.id === clean.branchId)?.name ?? null,
      permissions,
    })
    commit()
    if (detailsChanged || roleChanged)
      audit(
        staff,
        'staff.update',
        'staff',
        target.id,
        `Edited ${staffName(target)}${moved ? ` and moved them to ${target.branchName ?? 'head office'}` : ''}`,
      )
    if (added.length || removed.length) {
      const list = (ps: Permission[]) => ps.map((p) => PERMISSION_LABELS[p]).join(', ')
      audit(
        staff,
        'staff.permissions',
        'staff',
        target.id,
        `Changed ${staffName(target)}’s permissions.${added.length ? ` Gave: ${list(added)}.` : ''}${removed.length ? ` Removed: ${list(removed)}.` : ''}`,
      )
    }
    return HttpResponse.json(publicStaff(target))
  }),

  http.post(api('/staff/:id/:action/'), async ({ request, params }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'staff.manage')) return forbidden()
    const target = db().staff.find((s) => s.id === params.id)
    if (!target) return notFound()
    const action = String(params.action)
    const body = await readBody<{ reason: string }>(request)
    const reason = text(body.reason)
    if (target.role === 'md' && staff.role !== 'md')
      return forbidden('Only the managing director can change a managing director’s account.')
    if (target.id === staff.id && action !== 'reset-password')
      return badRequest('You can’t change your own access. Ask another administrator.')

    if (action === 'reset-password') {
      const password = temporaryPassword()
      updateStaff(target, { password: platform().hashPassword(password), mustChangePassword: true })
      audit(
        staff,
        'staff.reset_password',
        'staff',
        target.id,
        `Reset the password for ${staffName(target)}`,
      )
      return HttpResponse.json({ staff: publicStaff(target), temporary_password: password })
    }
    if (action !== 'suspend' && action !== 'reactivate' && action !== 'deactivate')
      return notFound()
    if (action !== 'reactivate' && reason.length < 5)
      return validationError({ reason: ['Give a reason. It is kept in the audit log.'] })
    if (action === 'reactivate' && target.status === 'active')
      return conflict(`${staffName(target)} is already active.`)
    if (action === 'suspend' && target.status !== 'active')
      return conflict(`${staffName(target)} is ${target.status}.`)
    if (action === 'deactivate') {
      const count = db().customers.filter(
        (c) => c.officerId === target.id && c.status !== 'inactive',
      ).length
      if (count > 0)
        return badRequest(
          `${staffName(target)} still has ${count} customers. Move them to another officer before deactivating.`,
        )
    }
    updateStaff(target, {
      status:
        action === 'reactivate' ? 'active' : action === 'suspend' ? 'suspended' : 'deactivated',
    })
    audit(
      staff,
      `staff.${action}`,
      'staff',
      target.id,
      `${action === 'reactivate' ? 'Reactivated' : action === 'suspend' ? 'Suspended' : 'Deactivated'} ${staffName(target)}${reason ? `: ${reason}` : ''}`,
    )
    return HttpResponse.json(publicStaff(target))
  }),

  // ── Bulk reassignment ──────────────────────────────────────────────────
  http.post(api('/customers/reassign/'), async ({ request }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'customers.reassign')) return forbidden()
    const body = await readBody<{ customerIds: string[]; officerId: string }>(request)
    const officer = db().staff.find((s) => s.id === body.officerId && s.role === 'account_officer')
    if (!officer || officer.status !== 'active')
      return validationError({ officerId: ['Choose an active officer.'] })
    const ids = new Set(Array.isArray(body.customerIds) ? body.customerIds : [])
    if (ids.size === 0) return validationError({ customerIds: ['Choose at least one customer.'] })
    const customers = db().customers.filter((c) => ids.has(c.id))
    const outside = customers.filter(
      (c) =>
        c.branchId !== officer.branchId ||
        (!can(staff, 'branches.all') && c.branchId !== staff.branchId),
    )
    if (outside.length)
      return validationError({
        officerId: ['Choose an officer in the same branch as these customers.'],
      })
    for (const c of customers) {
      c.officerId = officer.id
      c.officerName = staffName(officer)
      for (const a of db().accounts) if (a.customerId === c.id) a.officerId = officer.id
      for (const l of db().loans) if (l.customerId === c.id) l.officerId = officer.id
    }
    commit()
    audit(
      staff,
      'customer.reassign',
      'customer',
      null,
      `Moved ${customers.length} customers to ${staffName(officer)}`,
    )
    return HttpResponse.json({ moved: customers.length })
  }),
]

async function saveBranch(request: Request, id: string | null) {
  await delay()
  const staff = authenticate(request)
  if (staff instanceof Response) return staff
  if (!can(staff, 'branches.manage')) return forbidden()
  const existing = id ? db().branches.find((b) => b.id === id) : undefined
  if (id && !existing) return notFound()
  const body = await readBody<Record<string, unknown>>(request)
  const pick = (k: string) =>
    k in body ? body[k] : (existing as Record<string, unknown> | undefined)?.[k]
  const limit = platform().branchLimit()
  const operational = db().branches.filter((b) => b.kind === 'branch').length
  if (!existing && limit !== null && operational >= limit)
    return badRequest(
      `Your EMS licence covers ${limit} ${limit === 1 ? 'branch' : 'branches'}. Contact Entacrest to add more.`,
      'licence_limit',
    )
  const errors: Record<string, string[]> = {}
  const name = text(pick('name'))
  if (!name) errors.name = ['Enter the branch name.']
  else if (db().branches.some((b) => b.name.toLowerCase() === name.toLowerCase() && b.id !== id))
    errors.name = ['Another branch has this name.']
  const isHq = existing?.kind === 'headquarters'
  const code = text(pick('code'))
  if (!isHq && code === '00') errors.code = ['00 is reserved for headquarters.']
  else if (!/^\d{2}$/.test(code))
    errors.code = ['Use two digits. They start every account number in this branch.']
  else if (db().branches.some((b) => b.code === code && b.id !== id))
    errors.code = ['Another branch uses this code.']
  else if (
    existing &&
    code !== existing.code &&
    db().accounts.some((a) => a.branchId === existing.id)
  ) {
    errors.code = ['This branch already has accounts, so its code can’t change.']
  }
  const address = text(pick('address'))
  if (!address) errors.address = ['Enter the address.']
  const phone = normalisePhone(text(pick('phone')))
  if (!phone) errors.phone = ['Enter a Nigerian phone number.']
  const areas = (Array.isArray(pick('areas')) ? (pick('areas') as unknown[]) : [])
    .map(text)
    .filter(Boolean)
  // Headquarters collects from no one, so it has no areas.
  if (!isHq && areas.length === 0) errors.areas = ['Add at least one collection area.']
  const managerId = (pick('managerId') as string | null) || null
  const manager = managerId ? db().staff.find((s) => s.id === managerId) : null
  const managerRole = isHq ? 'general_manager' : 'branch_manager'
  if (managerId && (!manager || manager.role !== managerRole))
    errors.managerId = [isHq ? 'Choose a general manager.' : 'Choose a branch manager.']
  const status = pick('status') ?? 'active'
  if (status !== 'active' && status !== 'inactive') errors.status = ['Choose active or inactive.']
  if (isHq && status === 'inactive') errors.status = ['Headquarters can’t be closed.']
  if (
    existing &&
    status === 'inactive' &&
    db().customers.some((c) => c.branchId === existing.id && c.status === 'active')
  ) {
    errors.status = ['This branch still has active customers. Move them before closing it.']
  }
  if (Object.keys(errors).length) return validationError(errors)
  const values = {
    name,
    code,
    address,
    phone: phone!,
    areas: isHq ? [] : [...new Set(areas)],
    managerId,
    managerName: manager ? staffName(manager) : null,
    status: status as 'active' | 'inactive',
  }
  if (existing) {
    const renamed = existing.name !== name
    Object.assign(existing, values)
    if (renamed) {
      for (const s of db().staff) if (s.branchId === existing.id) s.branchName = name
      for (const c of db().customers) if (c.branchId === existing.id) c.branchName = name
    }
    commit()
    audit(staff, 'branch.update', 'branch', existing.id, `Edited ${name} branch`)
    return HttpResponse.json(serialize(existing))
  }
  // There is one headquarters; anything added here is an operational branch.
  const branch = {
    id: newId(),
    kind: 'branch' as const,
    ...values,
    staffCount: 0,
    customerCount: 0,
    createdAt: toLagosIso(),
  }
  db().branches.push(branch)
  commit()
  audit(staff, 'branch.create', 'branch', branch.id, `Opened ${name} branch (code ${code})`)
  return HttpResponse.json(serialize(branch), { status: 201 })
}
