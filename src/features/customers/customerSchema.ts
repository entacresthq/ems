import { z } from 'zod'
import { isValidBvn } from '@/lib/bvn'
import { normalisePhone } from '@/lib/phone'
import type { Customer, CustomerInput } from '@/types'

const required = (message: string) => z.string().trim().min(1, message)
const phone = required('Enter a phone number.').refine((v) => normalisePhone(v) !== null, {
  message: 'Enter a Nigerian mobile number, like 0803 123 4567 or +234 803 123 4567.',
})
const optionalPhone = z
  .string()
  .trim()
  .refine((v) => v === '' || normalisePhone(v) !== null, {
    message: 'Enter a Nigerian mobile number, or leave this empty.',
  })
const optionalBvn = z
  .string()
  .trim()
  .refine((v) => v === '' || isValidBvn(v), { message: 'BVN must be exactly 11 digits.' })

export const guarantorSchema = z.object({
  fullName: required('Enter the guarantor’s name.'),
  phone,
  address: required('Enter the guarantor’s address.'),
  relationship: z.string().trim(),
  occupation: z.string().trim(),
  bvn: optionalBvn,
})

export const customerSchema = z
  .object({
    firstName: required('Enter the first name.'),
    lastName: required('Enter the last name.'),
    otherNames: z.string().trim(),
    gender: z.enum(['female', 'male'], { errorMap: () => ({ message: 'Choose female or male.' }) }),
    dateOfBirth: z.string(),
    phone,
    altPhone: optionalPhone,
    email: z
      .string()
      .trim()
      .refine((v) => v === '' || z.string().email().safeParse(v).success, {
        message: 'Enter a valid email address, or leave this empty.',
      }),
    bvn: optionalBvn,
    address: required('Enter the home or shop address.'),
    area: required('Choose the collection area.'),
    occupation: required('Enter what the customer does for a living.'),
    branchId: required('Choose a branch.'),
    officerId: required('Choose the officer who will collect from this customer.'),
    nextOfKin: z.object({
      fullName: z.string().trim(),
      relationship: z.string().trim(),
      phone: optionalPhone,
      address: z.string().trim(),
    }),
    guarantors: z.array(guarantorSchema).max(3, 'Add up to three guarantors.'),
  })
  .superRefine((v, ctx) => {
    if (v.dateOfBirth) {
      const age = (Date.now() - new Date(v.dateOfBirth).getTime()) / (365.25 * 86_400_000)
      if (age < 18)
        ctx.addIssue({
          code: 'custom',
          path: ['dateOfBirth'],
          message: 'Customers must be at least 18 years old.',
        })
    }
    const kin = v.nextOfKin
    if (kin.fullName || kin.phone) {
      if (!kin.fullName)
        ctx.addIssue({
          code: 'custom',
          path: ['nextOfKin', 'fullName'],
          message: 'Enter the next of kin’s name.',
        })
      if (!kin.relationship)
        ctx.addIssue({
          code: 'custom',
          path: ['nextOfKin', 'relationship'],
          message: 'Enter the relationship.',
        })
      if (!kin.phone)
        ctx.addIssue({
          code: 'custom',
          path: ['nextOfKin', 'phone'],
          message: 'Enter the next of kin’s phone number.',
        })
    }
  })

export type CustomerFormValues = z.infer<typeof customerSchema>

export const emptyGuarantor = {
  fullName: '',
  phone: '',
  address: '',
  relationship: '',
  occupation: '',
  bvn: '',
}

export function toFormValues(
  c: Customer | null,
  defaults: { branchId: string; officerId: string },
): CustomerFormValues {
  return {
    firstName: c?.firstName ?? '',
    lastName: c?.lastName ?? '',
    otherNames: c?.otherNames ?? '',
    gender: c?.gender ?? ('' as 'female'),
    dateOfBirth: c?.dateOfBirth ?? '',
    phone: c?.phone ?? '',
    altPhone: c?.altPhone ?? '',
    email: c?.email ?? '',
    bvn: c?.bvn ?? '',
    address: c?.address ?? '',
    area: c?.area ?? '',
    occupation: c?.occupation ?? '',
    branchId: c?.branchId ?? defaults.branchId,
    officerId: c?.officerId ?? defaults.officerId,
    nextOfKin: {
      fullName: c?.nextOfKin?.fullName ?? '',
      relationship: c?.nextOfKin?.relationship ?? '',
      phone: c?.nextOfKin?.phone ?? '',
      address: c?.nextOfKin?.address ?? '',
    },
    guarantors: (c?.guarantors ?? []).map((g) => ({ ...g, bvn: g.bvn ?? '' })),
  }
}

export function toInput(v: CustomerFormValues): CustomerInput {
  const orNull = (s: string) => (s.trim() === '' ? null : s.trim())
  return {
    ...v,
    dateOfBirth: orNull(v.dateOfBirth),
    phone: normalisePhone(v.phone) ?? v.phone,
    altPhone: v.altPhone ? normalisePhone(v.altPhone) : null,
    email: orNull(v.email),
    bvn: orNull(v.bvn),
    nextOfKin: v.nextOfKin.fullName
      ? { ...v.nextOfKin, phone: normalisePhone(v.nextOfKin.phone) ?? v.nextOfKin.phone }
      : null,
    guarantors: v.guarantors.map((g) => ({
      ...g,
      phone: normalisePhone(g.phone) ?? g.phone,
      bvn: orNull(g.bvn),
    })),
  }
}

/** Every field path the server may report, for mapping DRF errors onto the form. */
export const CUSTOMER_FIELDS = [
  'firstName',
  'lastName',
  'otherNames',
  'gender',
  'dateOfBirth',
  'phone',
  'altPhone',
  'email',
  'bvn',
  'address',
  'area',
  'occupation',
  'branchId',
  'officerId',
  'nextOfKin.fullName',
  'nextOfKin.relationship',
  'nextOfKin.phone',
  'nextOfKin.address',
  ...[0, 1, 2].flatMap((i) =>
    (['fullName', 'phone', 'address', 'relationship', 'occupation', 'bvn'] as const).map(
      (f) => `guarantors.${i}.${f}` as const,
    ),
  ),
] as const
