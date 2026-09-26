import { z } from 'zod'

export function isValidBvn(input: string): boolean {
  return /^\d{11}$/.test(input.replace(/\s/g, ''))
}

/** Show only the last four digits: •••••••1234 */
export function maskBvn(bvn: string): string {
  return '•'.repeat(Math.max(0, bvn.length - 4)) + bvn.slice(-4)
}

export const bvnSchema = z
  .string()
  .transform((v) => v.replace(/\s/g, ''))
  .refine((v) => v.length > 0, { message: 'Enter the BVN.' })
  .refine(isValidBvn, { message: 'BVN must be exactly 11 digits.' })
