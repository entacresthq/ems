import { beforeEach, describe, expect, it } from 'vitest'
import { settingsApi, staffAdminApi } from '@/api/admin'
import { authApi } from '@/api/auth'
import { isApiError, tokenStore } from '@/api/client'
import { transactionsApi } from '@/api/transactions'
import { naira } from '@/lib/money'
import { ROLE_PERMISSIONS } from '@/lib/permissions'
import { db, resetMockDb } from '../db'
import { issueAccess } from '../utils'

const as = (email: string) => {
  const staff = db().staff.find((s) => s.email === email)!
  tokenStore.set(issueAccess(staff.id))
  return staff
}

async function apiError(promise: Promise<unknown>) {
  try {
    await promise
  } catch (e) {
    if (isApiError(e)) return e
  }
  throw new Error('Expected the request to fail')
}

describe('administration', () => {
  beforeEach(async () => {
    await resetMockDb()
  })

  it('adds staff with a temporary password they must change', async () => {
    as('md@ems.ng')
    const branch = db().branches.find((b) => b.kind === 'branch')!
    const { staff, temporaryPassword } = await staffAdminApi.create({
      firstName: 'Aisha',
      lastName: 'Bello',
      email: 'aisha.bello@ems.ng',
      phone: '0803 555 0101',
      role: 'account_officer',
      branchId: branch.id,
      permissions: ['customers.view', 'accounts.view'],
    })
    expect(staff.mustChangePassword).toBe(true)
    // Only what was chosen, plus the field app every officer needs.
    expect([...staff.permissions].sort()).toEqual([
      'accounts.view',
      'customers.view',
      'field.collect',
    ])
    tokenStore.set(null)
    const challenge = await authApi.login({
      email: 'aisha.bello@ems.ng',
      password: temporaryPassword,
    })
    expect(challenge.challengeId).toBeTruthy()
    // Every change is audited.
    expect(db().audit.some((a) => a.action === 'staff.create' && a.entityId === staff.id)).toBe(
      true,
    )
  })

  it('won’t deactivate an officer who still has customers', async () => {
    as('admin@ems.ng')
    const officer = db().staff.find((s) => s.email === 'officer@ems.ng')!
    const err = await apiError(staffAdminApi.deactivate(officer.id, 'Left the company'))
    expect(err.message).toMatch(/Move them to another officer/)

    const customers = db()
      .customers.filter((c) => c.officerId === officer.id)
      .map((c) => c.id)
    const other = db().staff.find(
      (s) =>
        s.role === 'account_officer' &&
        s.branchId === officer.branchId &&
        s.id !== officer.id &&
        s.status === 'active',
    )!
    as('manager@ems.ng')
    await staffAdminApi.reassignCustomers(customers, other.id)
    as('admin@ems.ng')
    await staffAdminApi.deactivate(officer.id, 'Left the company')
    expect(officer.status).toBe('deactivated')
  })

  it('seats head-office roles at headquarters and keeps officers in branches', async () => {
    as('md@ems.ng')
    const hq = db().branches.find((b) => b.kind === 'headquarters')!
    const { staff } = await staffAdminApi.create({
      firstName: 'Tunde',
      lastName: 'Ajayi',
      email: 'tunde.ajayi@ems.ng',
      phone: '0803 555 0102',
      role: 'general_manager',
      branchId: null,
      permissions: ['dashboard.view'],
    })
    expect(staff.branchId).toBe(hq.id)
    const err = await apiError(
      staffAdminApi.create({
        firstName: 'Ngozi',
        lastName: 'Eze',
        email: 'ngozi.eze@ems.ng',
        phone: '0803 555 0103',
        role: 'account_officer',
        branchId: hq.id,
        permissions: [],
      }),
    )
    expect(err.fieldErrors.branchId).toBeDefined()
  })

  it('lets the general manager add staff with part of what the role allows', async () => {
    const gm = as('gm@ems.ng')
    expect(ROLE_PERMISSIONS[gm.role]).toEqual(
      expect.arrayContaining(['branches.all', 'approvals.decide', 'staff.permissions']),
    )
    const branch = db().branches.find((b) => b.kind === 'branch')!
    const input = {
      firstName: 'Kemi',
      lastName: 'Adebayo',
      email: 'kemi.adebayo@ems.ng',
      phone: '0803 555 0104',
      role: 'cashier' as const,
      branchId: branch.id,
    }
    // A permission the role doesn't allow is refused.
    let err = await apiError(
      staffAdminApi.create({ ...input, permissions: ['customers.view', 'loans.approve'] }),
    )
    expect(err.fieldErrors.permissions?.[0]).toMatch(/can’t have/)
    const { staff } = await staffAdminApi.create({
      ...input,
      permissions: ['dashboard.view', 'customers.view', 'transactions.post'],
    })
    const cashier = db().staff.find((s) => s.id === staff.id)!
    tokenStore.set(issueAccess(cashier.id))
    const me = await authApi.me()
    expect(me.permissions).toEqual(['dashboard.view', 'customers.view', 'transactions.post'])
    expect(me.permissions).not.toContain('loans.disburse')

    // Later changes are audited.
    as('gm@ems.ng')
    const updated = await staffAdminApi.update(staff.id, {
      permissions: ['dashboard.view', 'customers.view', 'transactions.post', 'loans.disburse'],
    })
    expect(updated.permissions).toContain('loans.disburse')
    expect(
      db().audit.some((a) => a.action === 'staff.permissions' && a.entityId === staff.id),
    ).toBe(true)

    // Nobody changes their own permissions.
    err = await apiError(staffAdminApi.update(gm.id, { permissions: ['dashboard.view'] }))
    expect(err.fieldErrors.permissions?.[0]).toMatch(/your own/)
  })

  it('never lets anyone give access they don’t have', async () => {
    as('gm@ems.ng')
    const err = await apiError(
      staffAdminApi.create({
        firstName: 'Bayo',
        lastName: 'Ola',
        email: 'bayo.ola@ems.ng',
        phone: '0803 555 0105',
        role: 'admin',
        branchId: null,
        permissions: ['staff.view', 'settings.manage'],
      }),
    )
    expect(err.fieldErrors.permissions?.[0]).toMatch(/only give permissions you have/)
    // Only the MD can add or change a managing director.
    const md = db().staff.find((s) => s.role === 'md')!
    expect((await apiError(staffAdminApi.suspend(md.id, 'Testing access'))).status).toBe(403)
    // Administrators run the system but don't add staff.
    as('admin@ems.ng')
    const denied = await apiError(
      staffAdminApi.create({
        firstName: 'Bayo',
        lastName: 'Ola',
        email: 'bayo.ola@ems.ng',
        phone: '0803 555 0105',
        role: 'cashier',
        branchId: db().branches.find((b) => b.kind === 'branch')!.id,
        permissions: ['customers.view'],
      }),
    )
    expect(denied.status).toBe(403)
  })

  it('applies the withdrawal limit from settings', async () => {
    as('admin@ems.ng')
    await settingsApi.update({ largeWithdrawalThreshold: naira(50_000) })
    const cashier = as('cashier@ems.ng')
    const account = db().accounts.find(
      (a) => a.branchId === cashier.branchId && a.type === 'savings' && a.status === 'active',
    )!
    account.balance = naira(200_000)
    const res = await transactionsApi.post({
      accountId: account.id,
      type: 'withdrawal',
      amount: naira(60_000),
      paymentMethod: 'cash',
      narration: '',
    })
    expect(res.status).toBe('pending_approval')
  })

  it('never lets permissions lock administrators out', async () => {
    as('md@ems.ng')
    const current = await settingsApi.get()
    const saved = await settingsApi.update({
      rolePermissions: { ...current.rolePermissions, admin: [] },
    })
    expect(saved.rolePermissions.admin).toEqual(
      expect.arrayContaining(['settings.manage', 'staff.manage']),
    )
    // Role keys stay as role names, not camelCased field names.
    expect(saved.rolePermissions.branch_manager).toContain('approvals.decide')
    // Changes apply to what users are given.
    const withoutReports = {
      ...saved.rolePermissions,
      accountant: saved.rolePermissions.accountant.filter((p) => p !== 'reports.view'),
    }
    await settingsApi.update({ rolePermissions: withoutReports })
    // Taking it from the role takes it from everyone in the role.
    expect(
      db()
        .staff.filter((s) => s.role === 'accountant')
        .every((s) => !s.permissions.includes('reports.view')),
    ).toBe(true)
    as('accountant@ems.ng')
    const me = await authApi.me()
    expect(me.permissions).not.toContain('reports.view')
  })
})
