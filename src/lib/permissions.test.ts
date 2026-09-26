import { describe, expect, it } from 'vitest'
import { assignPermissions, grantablePermissions, ROLE_PERMISSIONS } from './permissions'

describe('assigning permissions', () => {
  const gm = ROLE_PERMISSIONS.general_manager

  it('offers only what the role allows and the assigner holds', () => {
    const grantable = grantablePermissions(gm, ROLE_PERMISSIONS.admin)
    expect(grantable).toContain('staff.view')
    expect(grantable).not.toContain('settings.manage')
    // Nobody at head office collects, but officers still need the field app.
    expect(grantablePermissions(gm, ROLE_PERMISSIONS.account_officer)).toContain('field.collect')
  })

  it('leaves access the assigner doesn’t hold exactly as it was', () => {
    const result = assignPermissions({
      role: 'admin',
      available: ROLE_PERMISSIONS.admin,
      assigner: gm,
      requested: ['staff.view'],
      existing: ['staff.view', 'audit.view', 'settings.manage'],
    })
    // audit.view removed (the GM holds it); settings.manage kept (the GM doesn't).
    expect(result).toEqual(['staff.view', 'settings.manage'])
  })

  it('always keeps what a role can’t work without', () => {
    const result = assignPermissions({
      role: 'account_officer',
      available: ROLE_PERMISSIONS.account_officer,
      assigner: gm,
      requested: [],
      existing: [],
    })
    expect(result).toEqual(['field.collect'])
  })
})
