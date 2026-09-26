import { api } from './client'

/** Licence and set-up state of the desktop app. Not available on the web backend. */
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
  licence: LicenceInfo | null
  /** Identifies this computer, for licences tied to one machine. */
  machineCode: string
  onboarded: boolean
  businessName: string | null
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
}
