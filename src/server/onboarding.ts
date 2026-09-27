import { toLagosIso } from '@/lib/dates'
import { ROLE_PERMISSIONS } from '@/lib/permissions'
import { normalisePhone } from '@/lib/phone'
import { DEMO_PASSWORD } from '@/mocks/demoLogins'
import { passwordProblems } from '@/mocks/handlers/auth'
import { generateDb, type MockDb, type StaffRecord } from '@/mocks/seed/generate'
import { defaultSettings } from '@/mocks/seed/settings'
import type { AuditEntry, Branch } from '@/types'
import { hashPassword } from './platform'

export interface OnboardingInput {
  business: { name: string; address: string; phone: string; email: string }
  md: { firstName: string; lastName: string; email: string; phone: string; password: string }
  /** Load the sample branches, staff and customers for training. */
  sampleData: boolean
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Field errors in the same shape as the API's validation errors. */
export function validateOnboarding(raw: unknown): {
  errors: Record<string, string[]>
  input: OnboardingInput
} {
  const body = (raw ?? {}) as Record<string, Record<string, unknown> | unknown>
  const b = (body.business ?? {}) as Record<string, unknown>
  const m = (body.md ?? {}) as Record<string, unknown>
  const input: OnboardingInput = {
    business: {
      name: text(b.name),
      address: text(b.address),
      phone: normalisePhone(text(b.phone)) ?? '',
      email: text(b.email).toLowerCase(),
    },
    md: {
      firstName: text(m.firstName),
      lastName: text(m.lastName),
      email: text(m.email).toLowerCase(),
      phone: normalisePhone(text(m.phone)) ?? '',
      password: typeof m.password === 'string' ? m.password : '',
    },
    sampleData: body.sampleData === true,
  }
  const errors: Record<string, string[]> = {}
  if (!input.business.name) errors['business.name'] = ['Enter the business name.']
  if (!input.business.address) errors['business.address'] = ['Enter the head office address.']
  if (!input.business.phone) errors['business.phone'] = ['Enter a Nigerian phone number.']
  if (input.business.email && !EMAIL.test(input.business.email))
    errors['business.email'] = ['Enter a valid email address, or leave it empty.']
  if (!input.md.firstName) errors['md.firstName'] = ['Enter the first name.']
  if (!input.md.lastName) errors['md.lastName'] = ['Enter the last name.']
  if (!EMAIL.test(input.md.email))
    errors['md.email'] = ['Enter a valid email address. The MD signs in with it.']
  if (!input.md.phone)
    errors['md.phone'] = ['Enter a Nigerian mobile number. Sign-in codes are sent to it.']
  const problems = passwordProblems(input.md.password)
  if (problems.length) errors['md.password'] = problems
  return { errors, input }
}

/** The first database: the business, its headquarters and the managing director. */
export function initialData(input: OnboardingInput): MockDb {
  const now = toLagosIso()
  const data: MockDb = input.sampleData
    ? sampleData()
    : {
        settings: defaultSettings(now),
        audit: [],
        remittances: [],
        approvals: [],
        branches: [],
        staff: [],
        customers: [],
        thriftPlans: [],
        loanProducts: [],
        accounts: [],
        loans: [],
        transactions: [],
      }
  Object.assign(data.settings, {
    businessName: input.business.name,
    address: input.business.address,
    phone: input.business.phone,
    email: input.business.email,
    registrationNumber: input.sampleData ? data.settings.registrationNumber : '',
    updatedAt: now,
    updatedByName: null,
  })

  let hq = data.branches.find((b) => b.kind === 'headquarters')
  if (!hq) {
    hq = {
      id: crypto.randomUUID(),
      kind: 'headquarters',
      code: '00',
      name: 'Headquarters',
      address: input.business.address,
      phone: input.business.phone,
      areas: [],
      managerId: null,
      managerName: null,
      status: 'active',
      staffCount: 0,
      customerCount: 0,
      createdAt: now,
    } satisfies Branch
    data.branches.unshift(hq)
  }

  // The sample data has its own MD; the person setting up takes that seat.
  const md: StaffRecord = data.staff.find((s) => s.role === 'md') ?? {
    id: crypto.randomUUID(),
    staffId: 'EMS/0001',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    role: 'md',
    branchId: hq.id,
    branchName: hq.name,
    status: 'active',
    permissions: [...ROLE_PERMISSIONS.md],
    lastLoginAt: null,
    createdAt: now,
    password: '',
    mustChangePassword: false,
  }
  if (!data.staff.includes(md)) {
    data.staff.unshift(md)
    hq.staffCount += 1
  }
  Object.assign(md, {
    firstName: input.md.firstName,
    lastName: input.md.lastName,
    email: input.md.email,
    phone: input.md.phone,
    password: hashPassword(input.md.password),
    mustChangePassword: false,
    lastLoginAt: null,
  })

  const entry: AuditEntry = {
    id: crypto.randomUUID(),
    at: now,
    actorId: md.id,
    actorName: `${md.firstName} ${md.lastName}`,
    actorRole: 'md',
    action: 'system.onboard',
    entityType: 'settings',
    entityId: null,
    branchId: hq.id,
    summary: `Set up EMS for ${input.business.name}${input.sampleData ? ' with sample data' : ''}`,
    ipAddress: '127.0.0.1',
    userAgent: 'EMS desktop',
  }
  data.audit.unshift(entry)
  return data
}

/** The demo workspace: the training data under the demo business name, ready to sign in. */
export function demoData(): MockDb {
  const data = sampleData()
  data.settings.businessName = 'EMS demo (training data)'
  return data
}

/** The training data set. Every sample account keeps the demo password. */
function sampleData(): MockDb {
  const data = generateDb()
  const demoHash = hashPassword(DEMO_PASSWORD)
  for (const s of data.staff) s.password = demoHash
  return data
}
