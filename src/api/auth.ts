import type {
  AuthUser,
  ChangePasswordRequest,
  LoginChallenge,
  LoginRequest,
  OtpVerifyRequest,
  PasswordResetConfirmRequest,
  TokenResponse,
} from '@/types'
import { api, tokenStore } from './client'

export const authApi = {
  /** Step 1: check the password. The server sends an OTP by SMS. */
  login: (body: LoginRequest) => api.post<LoginChallenge>('/auth/login/', body, { auth: false }),

  /** Step 2: verify the OTP. The server sets the refresh cookie. */
  async verifyOtp(body: OtpVerifyRequest): Promise<AuthUser> {
    const data = await api.post<TokenResponse>('/auth/otp/verify/', body, { auth: false })
    tokenStore.set(data.access)
    return data.user
  },

  resendOtp: (challengeId: string) =>
    api.post<LoginChallenge>('/auth/otp/resend/', { challengeId }, { auth: false }),

  me: () => api.get<AuthUser>('/auth/me/'),

  async logout(): Promise<void> {
    try {
      await api.post('/auth/logout/', undefined, { auth: false })
    } finally {
      tokenStore.set(null)
    }
  },

  changePassword: (body: ChangePasswordRequest) =>
    api.post<AuthUser>('/auth/password/change/', body),

  requestPasswordReset: (email: string) =>
    api.post<void>('/auth/password/reset/', { email }, { auth: false }),

  confirmPasswordReset: (body: PasswordResetConfirmRequest) =>
    api.post<void>('/auth/password/reset/confirm/', body, { auth: false }),
}
