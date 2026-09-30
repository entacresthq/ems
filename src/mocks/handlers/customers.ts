import { delay, http, HttpResponse } from 'msw'
import { isValidBvn } from '@/lib/bvn'
import { toLagosIso } from '@/lib/dates'
import { normalisePhone } from '@/lib/phone'
import type { Customer, CustomerInput, Guarantor, NextOfKin } from '@/types'
import { commit, db } from '../db'
import { audit, newId, requestApproval, staffName } from '../domain'
import type { StaffRecord } from '../seed/generate'
import { out } from '../serializers'
import {
  api,
  applyOrdering,
  authenticate,
  badRequest,
  can,
  filterBySearch,
  forbidden,
  inScope,
  notFound,
  paginate,
  param,
  readBody,
  scopeRows,
  validationError,
} from '../utils'

type Errors = Record<string, string[]>

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const optional = (v: unknown) => text(v) || null

/** Validate a create/edit body the way a DRF serializer would. */
function validateCustomer(body: Partial<CustomerInput>, existingId: string | null) {
  const errors: Errors = {}
  const need = (key: keyof CustomerInput, message: string) => {
    if (!text(body[key])) errors[key] = [message]
  }
  need('firstName', 'Enter the first name.')
  need('lastName', 'Enter the last name.')
  need('address', 'Enter the home or shop address.')
  need('area', 'Choose the collection area.')
  need('occupation', 'Enter what the customer does for a living.')
  if (body.gender !== 'female' && body.gender !== 'male') errors.gender = ['Choose female or male.']

  const phone = normalisePhone(text(body.phone))
  if (!phone) errors.phone = ['Enter a Nigerian mobile number, like 0803 123 4567.']
  const altPhone = optional(body.altPhone)
  if (altPhone && !normalisePhone(altPhone))
    errors.altPhone = ['Enter a Nigerian mobile number, or leave this empty.']

  const bvn = optional(body.bvn)
  if (bvn) {
    if (!isValidBvn(bvn)) errors.bvn = ['BVN must be exactly 11 digits.']
    else {
      const owner = db().customers.find((c) => c.bvn === bvn && c.id !== existingId)
      if (owner) {
        errors.bvn = [
          `This BVN is already registered to ${owner.firstName} ${owner.lastName} (${owner.customerNumber}).`,
        ]
      }
    }
  }

  const email = optional(body.email)
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    errors.email = ['Enter a valid email address.']

  const dob = optional(body.dateOfBirth)
  if (dob) {
    const age = (Date.now() - new Date(dob).getTime()) / (365.25 * 86_400_000)
    if (Number.isNaN(age) || age < 18)
      errors.dateOfBirth = ['Customers must be at least 18 years old.']
    else if (age > 100) errors.dateOfBirth = ['Check the year of birth.']
  }

  let nextOfKin: NextOfKin | null = null
  const kin = body.nextOfKin
  if (kin && (text(kin.fullName) || text(kin.phone))) {
    const kinErrors: Errors = {}
    if (!text(kin.fullName)) kinErrors.fullName = ['Enter the next of kin’s name.']
    if (!text(kin.relationship)) kinErrors.relationship = ['Enter the relationship.']
    if (!normalisePhone(text(kin.phone))) kinErrors.phone = ['Enter a Nigerian mobile number.']
    for (const [k, v] of Object.entries(kinErrors)) errors[`nextOfKin.${k}`] = v
    nextOfKin = {
      fullName: text(kin.fullName),
      relationship: text(kin.relationship),
      phone: normalisePhone(text(kin.phone)) ?? text(kin.phone),
      address: text(kin.address),
    }
  }

  const existing = existingId ? db().customers.find((c) => c.id === existingId) : undefined
  const guarantors: Guarantor[] = []
  ;(body.guarantors ?? []).forEach((g, i) => {
    if (!text(g.fullName)) errors[`guarantors.${i}.fullName`] = ['Enter the guarantor’s name.']
    if (!normalisePhone(text(g.phone)))
      errors[`guarantors.${i}.phone`] = ['Enter a Nigerian mobile number.']
    if (!text(g.address)) errors[`guarantors.${i}.address`] = ['Enter the guarantor’s address.']
    const gBvn = optional(g.bvn)
    if (gBvn && !isValidBvn(gBvn))
      errors[`guarantors.${i}.bvn`] = ['BVN must be exactly 11 digits.']
    // A guarantor who is already on file keeps their photo and signature.
    const known = existing?.guarantors.find((x) => x.id === g.id)
    guarantors.push({
      id: known?.id ?? newId(),
      photoUrl: known?.photoUrl ?? null,
      signatureUrl: known?.signatureUrl ?? null,
      fullName: text(g.fullName),
      phone: normalisePhone(text(g.phone)) ?? text(g.phone),
      address: text(g.address),
      relationship: text(g.relationship),
      occupation: text(g.occupation),
      bvn: gBvn,
    })
  })

  return {
    errors,
    clean: {
      firstName: text(body.firstName),
      lastName: text(body.lastName),
      otherNames: text(body.otherNames),
      gender: body.gender as Customer['gender'],
      dateOfBirth: dob,
      phone: phone ?? '',
      altPhone: altPhone ? normalisePhone(altPhone) : null,
      email,
      bvn,
      address: text(body.address),
      area: text(body.area),
      occupation: text(body.occupation),
      nextOfKin,
      guarantors,
    },
  }
}

function assignment(staff: StaffRecord, body: Partial<CustomerInput>, errors: Errors) {
  // Officers always register customers for themselves in their own branch.
  if (staff.role === 'account_officer') return { branchId: staff.branchId!, officer: staff }
  const branchId = can(staff, 'branches.all') ? text(body.branchId) : staff.branchId!
  const branch = db().branches.find((b) => b.id === branchId && b.kind === 'branch')
  if (!branch) errors.branchId = ['Choose a branch. Customers can’t be registered at headquarters.']
  const officer = db().staff.find((s) => s.id === body.officerId && s.role === 'account_officer')
  if (!officer)
    errors.officerId = ['Choose the account officer who will collect from this customer.']
  else if (officer.branchId !== branchId)
    errors.officerId = ['This officer works in a different branch.']
  else if (officer.status !== 'active')
    errors.officerId = [`${staffName(officer)} is ${officer.status}. Choose an active officer.`]
  return { branchId, officer }
}

/** Read an uploaded image as a data URL, or say why it can't be used. */
async function readImage(request: Request): Promise<string | Response> {
  const form = await request.formData().catch(() => null)
  const entry = form?.get('file')
  // Check what it can do, not its class: the server's Blob and the page's Blob can
  // be different classes (Node vs the browser, and in tests).
  if (!entry || typeof entry === 'string' || typeof entry.arrayBuffer !== 'function')
    return badRequest('Choose an image to upload.')
  const file = entry as Blob
  if (!file.type.startsWith('image/'))
    return validationError({ file: ['Upload a JPG or PNG image.'] })
  if (file.size > 2 * 1024 * 1024)
    return validationError({ file: ['The image is larger than 2 MB. Take a smaller photo.'] })
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${file.type};base64,${btoa(binary)}`
}

async function saveUpload(
  request: Request,
  staff: StaffRecord,
  customer: Customer,
  field: 'photoUrl' | 'signatureUrl',
) {
  const image = await readImage(request)
  if (image instanceof Response) return image
  customer[field] = image
  commit()
  audit(
    staff,
    field === 'photoUrl' ? 'customer.photo' : 'customer.signature',
    'customer',
    customer.id,
    `Uploaded ${field === 'photoUrl' ? 'photo' : 'signature'} for ${customer.firstName} ${customer.lastName}`,
  )
  return HttpResponse.json(out.customer(customer))
}

export const customerHandlers = [
  http.get(api('/customers/'), async ({ request }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'customers.view')) return forbidden()
    let rows = scopeRows(staff, db().customers)
    const filters = {
      branch: 'branchId',
      officer: 'officerId',
      status: 'status',
      area: 'area',
    } as const
    for (const [key, field] of Object.entries(filters)) {
      const value = param(request, key)
      if (value) rows = rows.filter((c) => c[field] === value)
    }
    rows = filterBySearch(rows, param(request, 'search'), [
      (c) => `${c.firstName} ${c.otherNames} ${c.lastName}`,
      (c) => `${c.firstName} ${c.lastName}`,
      (c) => c.customerNumber,
      (c) => c.phone,
      (c) => c.bvn,
    ])
    rows = applyOrdering(rows, param(request, 'ordering') ?? 'last_name', [
      'last_name',
      'first_name',
      'customer_number',
      'area',
      'officer_name',
      'branch_name',
      'status',
      'created_at',
    ])
    return paginate(request, rows, out.customer)
  }),

  http.get(api('/customers/:id/'), async ({ request, params }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    const customer = scopeRows(staff, db().customers).find((c) => c.id === params.id)
    return customer ? HttpResponse.json(out.customer(customer)) : notFound()
  }),

  http.post(api('/customers/'), async ({ request }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'customers.create')) return forbidden()
    const body = await readBody<CustomerInput>(request)
    const { errors, clean } = validateCustomer(body, null)
    const { branchId, officer } = assignment(staff, body, errors)
    const fromField = staff.role === 'account_officer'
    const plan = db().thriftPlans.find((p) => p.id === body.thriftPlanId && p.status === 'active')
    if (fromField && !plan)
      errors.thriftPlanId = ['Choose the thrift plan the customer wants to join.']
    if (Object.keys(errors).length || !officer) return validationError(errors)

    const branch = db().branches.find((b) => b.id === branchId)!
    const serial = Math.max(0, ...db().customers.map((c) => Number(c.customerNumber.slice(3)))) + 1
    const customer: Customer = {
      id: newId(),
      customerNumber: `C${branch.code}${String(serial).padStart(5, '0')}`,
      ...clean,
      branchId,
      branchName: branch.name,
      officerId: officer.id,
      officerName: staffName(officer),
      status: fromField ? 'pending_approval' : 'active',
      photoUrl: null,
      signatureUrl: null,
      createdAt: toLagosIso(),
    }
    db().customers.push(customer)
    branch.customerCount += 1

    if (fromField) {
      requestApproval(staff, {
        type: 'customer_registration',
        subject: `New thrift customer ${customer.firstName} ${customer.lastName}, ${customer.area}`,
        branchId,
        customerId: customer.id,
        customerName: `${customer.firstName} ${customer.lastName}`,
        reason: `Registered in the field. Wants to join ${plan!.name}.`,
        payload: { thriftPlanId: plan!.id },
      })
    }
    commit()
    audit(
      staff,
      'customer.create',
      'customer',
      customer.id,
      `Registered ${customer.firstName} ${customer.lastName} (${customer.customerNumber})`,
    )
    return HttpResponse.json(out.customer(customer), { status: 201 })
  }),

  http.patch(api('/customers/:id/'), async ({ request, params }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'customers.edit')) return forbidden()
    const customer = scopeRows(staff, db().customers).find((c) => c.id === params.id)
    if (!customer) return notFound()
    const body = await readBody<CustomerInput>(request)
    const { errors, clean } = validateCustomer({ ...customer, ...body }, customer.id)
    if (Object.keys(errors).length) return validationError(errors)
    Object.assign(customer, clean)
    const name = `${customer.firstName} ${customer.lastName}`
    for (const a of db().accounts) if (a.customerId === customer.id) a.customerName = name
    commit()
    audit(
      staff,
      'customer.update',
      'customer',
      customer.id,
      `Edited details of ${name} (${customer.customerNumber})`,
    )
    return HttpResponse.json(out.customer(customer))
  }),

  http.post(api('/customers/:id/photo/'), async ({ request, params }) => {
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'customers.edit') && !can(staff, 'customers.create')) return forbidden()
    const customer = scopeRows(staff, db().customers).find((c) => c.id === params.id)
    if (!customer) return notFound()
    return saveUpload(request, staff, customer, 'photoUrl')
  }),

  http.post(api('/customers/:id/signature/'), async ({ request, params }) => {
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'customers.edit') && !can(staff, 'customers.create')) return forbidden()
    const customer = scopeRows(staff, db().customers).find((c) => c.id === params.id)
    if (!customer) return notFound()
    return saveUpload(request, staff, customer, 'signatureUrl')
  }),

  http.post(api('/customers/:id/guarantors/:guarantorId/:kind/'), async ({ request, params }) => {
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'customers.edit') && !can(staff, 'customers.create')) return forbidden()
    if (params.kind !== 'photo' && params.kind !== 'signature') return notFound()
    const customer = scopeRows(staff, db().customers).find((c) => c.id === params.id)
    const guarantor = customer?.guarantors.find((g) => g.id === params.guarantorId)
    if (!customer || !guarantor) return notFound()
    const image = await readImage(request)
    if (image instanceof Response) return image
    guarantor[params.kind === 'photo' ? 'photoUrl' : 'signatureUrl'] = image
    commit()
    audit(
      staff,
      `customer.guarantor.${params.kind}`,
      'customer',
      customer.id,
      `Uploaded ${params.kind} of guarantor ${guarantor.fullName} for ${customer.firstName} ${customer.lastName}`,
    )
    return HttpResponse.json(out.customer(customer))
  }),

  http.post(api('/customers/:id/reassign/'), async ({ request, params }) => {
    await delay()
    const staff = authenticate(request)
    if (staff instanceof Response) return staff
    if (!can(staff, 'customers.reassign')) return forbidden()
    const customer = db().customers.find((c) => c.id === params.id)
    if (!customer || !inScope(staff, customer)) return notFound()
    const body = await readBody<{ officerId: string }>(request)
    const officer = db().staff.find((s) => s.id === body.officerId && s.role === 'account_officer')
    if (!officer) return validationError({ officerId: ['Choose an officer.'] })
    if (officer.status !== 'active')
      return validationError({ officerId: [`${staffName(officer)} is ${officer.status}.`] })
    if (officer.id === customer.officerId)
      return validationError({
        officerId: [`${staffName(officer)} already looks after this customer.`],
      })
    if (officer.branchId !== customer.branchId && !can(staff, 'branches.all')) {
      return validationError({
        officerId: [
          'Choose an officer in this branch. Only head office can move customers between branches.',
        ],
      })
    }
    const branch = db().branches.find((b) => b.id === officer.branchId)!
    customer.officerId = officer.id
    customer.officerName = staffName(officer)
    customer.branchId = branch.id
    customer.branchName = branch.name
    for (const a of db().accounts) {
      if (a.customerId !== customer.id) continue
      a.officerId = officer.id
      a.branchId = branch.id
    }
    for (const l of db().loans) {
      if (l.customerId !== customer.id) continue
      l.officerId = officer.id
      l.branchId = branch.id
    }
    commit()
    audit(
      staff,
      'customer.reassign',
      'customer',
      customer.id,
      `Moved ${customer.firstName} ${customer.lastName} to ${staffName(officer)}`,
    )
    return HttpResponse.json(out.customer(customer))
  }),
]
