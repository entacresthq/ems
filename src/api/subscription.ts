import { parseDecimal, type Kobo } from '@/lib/money'
import { api } from './client'

/**
 * Hosted EMS: sign-up, plans and payments, kept by SynchGate and reached through the EMS
 * server. Not part of the Django API; only an EMS hub with EMS_SAAS_URL answers these.
 */

export interface Plan {
  code: string
  name: string
  description: string
  monthlyPrice: Kobo
  /** Most operational branches; null for no limit. */
  maxBranches: number | null
  features: string[]
}

export type SubscriptionState = 'trial' | 'active' | 'past_due' | 'expired' | 'suspended'

export interface Tenant {
  /** The business's id, and the first part of its address. */
  id: string
  businessName: string
  ownerEmail: string
  status: SubscriptionState
  plan: Plan
  trialEndsAt: string | null
  paidThrough: string | null
  /** The later of the two above. */
  accessEndsAt: string | null
  /** yyyy-mm-dd: EMS locks after this day unless renewed. */
  licenceExpires: string | null
  graceDays: number
  address: string | null
}

export interface Payment {
  reference: string
  planCode: string
  planName: string
  months: number
  amount: Kobo
  status: 'pending' | 'paid' | 'failed'
  failureReason: string
  periodStart: string | null
  periodEnd: string | null
  paidAt: string | null
  createdAt: string
}

export interface SubscriptionSummary {
  tenant: Tenant
  plans: Plan[]
  monthOptions: number[]
  payments: Payment[]
}

export interface CheckoutStarted {
  paymentUrl: string
  reference: string
}

type Wire<T, K extends keyof T> = Omit<T, K> & { [P in K]: string }

const plan = (p: Wire<Plan, 'monthlyPrice'>): Plan => ({
  ...p,
  monthlyPrice: parseDecimal(p.monthlyPrice),
})

export const decodePayment = (p: Wire<Payment, 'amount'>): Payment => ({
  ...p,
  amount: parseDecimal(p.amount),
})

const tenant = (t: Omit<Tenant, 'plan'> & { plan: Wire<Plan, 'monthlyPrice'> }): Tenant => ({
  ...t,
  plan: plan(t.plan),
})

export const subscriptionKeys = { summary: ['subscription'] as const }

export const subscriptionApi = {
  summary: async (): Promise<SubscriptionSummary> => {
    const raw = await api.get<{
      tenant: Parameters<typeof tenant>[0]
      plans: Wire<Plan, 'monthlyPrice'>[]
      monthOptions: number[]
      payments: Wire<Payment, 'amount'>[]
    }>('/subscription/')
    return {
      tenant: tenant(raw.tenant),
      plans: raw.plans.map(plan),
      monthOptions: raw.monthOptions,
      payments: raw.payments.map(decodePayment),
    }
  },
  checkout: (input: { plan: string; months: number }) =>
    api.post<CheckoutStarted>('/subscription/checkout/', input),
  /** Back from Paystack: confirms the payment. */
  verify: async (reference: string) => {
    const raw = await api.post<{ payment: Wire<Payment, 'amount'> }>('/subscription/verify/', {
      reference,
    })
    return decodePayment(raw.payment)
  },
}

// ── Sign-up, at the bare EMS address ──────────────────────────────────────

export interface SignupOffer {
  plans: Plan[]
  trialDays: number
  graceDays: number
  monthOptions: number[]
}

export interface SignupRequest {
  plan: string
  slug: string
  businessName: string
  businessAddress: string
  businessPhone: string
  businessEmail: string
  firstName: string
  lastName: string
  email: string
  phone: string
  password: string
}

export const signupApi = {
  offer: async (): Promise<SignupOffer> => {
    const raw = await api.get<Omit<SignupOffer, 'plans'> & { plans: Wire<Plan, 'monthlyPrice'>[] }>(
      '/plans/',
      { auth: false },
    )
    return { ...raw, plans: raw.plans.map(plan) }
  },
  check: (slug: string) =>
    api.get<{ slug: string; available: boolean; reason: string | null }>('/signup/check/', {
      query: { slug },
      auth: false,
    }),
  signup: (input: SignupRequest) =>
    api.post<{ id: string; trialEndsAt: string | null }>('/signup/', input, {
      auth: false,
    }),
}
