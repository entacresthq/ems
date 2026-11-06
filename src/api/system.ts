import { api } from './client'
import { decodePayment, type CheckoutStarted, type Payment } from './subscription'

/** Licence and set-up state of an EMS server (web or desktop). The Django backend won't have it. */
export interface LicenceInfo {
  status: 'valid' | 'expired' | 'wrong_machine' | 'invalid'
  id?: string
  licensee?: string
  plan?: string
  /** Most operational branches allowed; null for no limit. */
  branches?: number | null
  issued?: string
  expires?: string | null
  /** Why an invalid code was refused. */
  reason?: string
}

export interface SystemStatus {
  /** "demo": the training workspace, with sample data and the demo accounts. */
  mode: 'live' | 'demo'
  licence: LicenceInfo | null
  /** Identifies this computer, for licences tied to one machine. */
  machineCode: string
  onboarded: boolean
  businessName: string | null
  database: 'sqlite' | 'postgres'
  /** "outbox" until an SMS provider is connected. */
  sms: 'outbox' | 'termii' | 'africastalking'
  /** Hosted EMS: the licence comes from a subscription, renewed by paying, not by a code. */
  subscription?: boolean
}

export interface OnboardingRequest {
  business: { name: string; address: string; phone: string; email: string }
  md: { firstName: string; lastName: string; email: string; phone: string; password: string }
  sampleData: boolean
}

export const systemKeys = { status: ['system', 'status'] as const }

export const systemApi = {
  status: () => api.get<SystemStatus>('/system/status/', { auth: false }),
  activate: (code: string) => api.post<SystemStatus>('/system/licence/', { code }, { auth: false }),
  onboard: (input: OnboardingRequest) =>
    api.post<{ email: string; sampleData: boolean }>('/system/onboarding/', input, {
      auth: false,
    }),
  /** Hosted EMS, from the lock screen: a month of the current plan. */
  renew: () => api.post<CheckoutStarted>('/system/subscription/renew/', {}, { auth: false }),
  /** Hosted EMS, back from checkout: confirms the payment and applies the new licence. */
  verifyPayment: async (reference: string) => {
    const raw = await api.post<{
      payment: Parameters<typeof decodePayment>[0]
      status: SystemStatus
    }>('/system/subscription/verify/', { reference }, { auth: false })
    return { payment: decodePayment(raw.payment) as Payment, status: raw.status }
  },
}
