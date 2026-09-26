import type { Role } from '@/types'

export const DEMO_PASSWORD = 'Demo@2026'
export const DEMO_OTP = '123456'

/** Named demo logins, shown on the sign-in screen when mocks are on. */
export const DEMO_LOGINS: readonly { email: string; role: Role; note: string }[] = [
  { email: 'md@ems.ng', role: 'md', note: 'Headquarters, everything' },
  { email: 'gm@ems.ng', role: 'general_manager', note: 'Headquarters, all branch operations' },
  { email: 'manager@ems.ng', role: 'branch_manager', note: 'Egbeda' },
  { email: 'accountant@ems.ng', role: 'accountant', note: 'Egbeda' },
  { email: 'cashier@ems.ng', role: 'cashier', note: 'Egbeda' },
  { email: 'officer@ems.ng', role: 'account_officer', note: 'Egbeda, opens the field app' },
  { email: 'admin@ems.ng', role: 'admin', note: 'Headquarters, system setup' },
  { email: 'newstaff@ems.ng', role: 'cashier', note: 'Ikotun, must change password' },
  { email: 'suspended@ems.ng', role: 'account_officer', note: 'Suspended account' },
]
