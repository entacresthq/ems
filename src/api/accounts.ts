import { toDecimal } from '@/lib/money'
import type { Account, AccountListParams, Approval, Id, Paginated, SavingsTarget } from '@/types'
import { api } from './client'
import { decodePage } from './decode'
import { decode, type WireAccount, type WireApproval } from './decoders'

export const accountKeys = {
  all: ['accounts'] as const,
  list: (params: AccountListParams = {}) => [...accountKeys.all, 'list', params] as const,
  detail: (id: Id) => [...accountKeys.all, 'detail', id] as const,
}

export const accountsApi = {
  async list(params: AccountListParams = {}): Promise<Paginated<Account>> {
    const page = await api.get<Paginated<WireAccount>>('/accounts/', { query: { ...params } })
    return decodePage(page, decode.account)
  },
  async get(id: Id): Promise<Account> {
    return decode.account(await api.get<WireAccount>(`/accounts/${id}/`))
  },
  async open(body: {
    customerId: Id
    type: 'savings' | 'target' | 'thrift'
    thriftPlanId: Id | null
    /** Target savings only. */
    target?: SavingsTarget
  }): Promise<Account> {
    const { target, ...rest } = body
    return decode.account(
      await api.post<WireAccount>('/accounts/', {
        ...rest,
        ...(target ? { target: { ...target, targetAmount: toDecimal(target.targetAmount) } } : {}),
      }),
    )
  },
  async freeze(id: Id, reason: string): Promise<Account> {
    return decode.account(await api.post<WireAccount>(`/accounts/${id}/freeze/`, { reason }))
  },
  async unfreeze(id: Id): Promise<Account> {
    return decode.account(await api.post<WireAccount>(`/accounts/${id}/unfreeze/`))
  },
  async reactivate(id: Id): Promise<Account> {
    return decode.account(await api.post<WireAccount>(`/accounts/${id}/reactivate/`))
  },
  async requestClosure(id: Id, reason: string): Promise<Approval> {
    return decode.approval(
      await api.post<WireApproval>(`/accounts/${id}/closure-request/`, { reason }),
    )
  },
}
