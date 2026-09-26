import type { Account, AccountListParams, Approval, Id, Paginated } from '@/types'
import { api } from './client'
import { decodePage, type Wire } from './decode'
import { decode, type WireApproval } from './decoders'

export const accountKeys = {
  all: ['accounts'] as const,
  list: (params: AccountListParams = {}) => [...accountKeys.all, 'list', params] as const,
  detail: (id: Id) => [...accountKeys.all, 'detail', id] as const,
}

export const accountsApi = {
  async list(params: AccountListParams = {}): Promise<Paginated<Account>> {
    const page = await api.get<Paginated<Wire<Account>>>('/accounts/', { query: { ...params } })
    return decodePage(page, decode.account)
  },
  async get(id: Id): Promise<Account> {
    return decode.account(await api.get<Wire<Account>>(`/accounts/${id}/`))
  },
  async open(body: {
    customerId: Id
    type: 'savings' | 'thrift'
    thriftPlanId: Id | null
  }): Promise<Account> {
    return decode.account(await api.post<Wire<Account>>('/accounts/', body))
  },
  async freeze(id: Id, reason: string): Promise<Account> {
    return decode.account(await api.post<Wire<Account>>(`/accounts/${id}/freeze/`, { reason }))
  },
  async unfreeze(id: Id): Promise<Account> {
    return decode.account(await api.post<Wire<Account>>(`/accounts/${id}/unfreeze/`))
  },
  async reactivate(id: Id): Promise<Account> {
    return decode.account(await api.post<Wire<Account>>(`/accounts/${id}/reactivate/`))
  },
  async requestClosure(id: Id, reason: string): Promise<Approval> {
    return decode.approval(
      await api.post<WireApproval>(`/accounts/${id}/closure-request/`, { reason }),
    )
  },
}
