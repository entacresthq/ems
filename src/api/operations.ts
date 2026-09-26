import { toDecimal, type Kobo } from '@/lib/money'
import type {
  Approval,
  ApprovalListParams,
  Id,
  IsoDate,
  Paginated,
  Remittance,
  RemittanceListParams,
} from '@/types'
import { api } from './client'
import { decodePage } from './decode'
import { decode, type WireApproval, type WireRemittance } from './decoders'

export const remittanceKeys = {
  all: ['remittances'] as const,
  list: (params: RemittanceListParams) => [...remittanceKeys.all, params] as const,
}

export const approvalKeys = {
  all: ['approvals'] as const,
  list: (params: ApprovalListParams) => [...approvalKeys.all, 'list', params] as const,
  pendingCount: (branch: Id | null) => [...approvalKeys.all, 'pending-count', branch] as const,
}

export const remittancesApi = {
  async list(params: RemittanceListParams): Promise<Paginated<Remittance>> {
    const page = await api.get<Paginated<WireRemittance>>('/remittances/', {
      query: { pageSize: 100, ...params },
    })
    return decodePage(page, decode.remittance)
  },
  async confirm(body: {
    officerId: Id
    date: IsoDate
    cashReceived: Kobo
    note: string
  }): Promise<Remittance> {
    const res = await api.post<WireRemittance>('/remittances/confirm/', {
      ...body,
      cashReceived: toDecimal(body.cashReceived),
    })
    return decode.remittance(res)
  },
  /** Officer submits today's cash for counting. */
  async submit(date: IsoDate): Promise<Remittance> {
    return decode.remittance(await api.post<WireRemittance>('/remittances/', { date }))
  },
}

export const approvalsApi = {
  async list(params: ApprovalListParams): Promise<Paginated<Approval>> {
    const page = await api.get<Paginated<WireApproval>>('/approvals/', { query: { ...params } })
    return decodePage(page, decode.approval)
  },
  async get(id: Id): Promise<Approval> {
    return decode.approval(await api.get<WireApproval>(`/approvals/${id}/`))
  },
  async approve(id: Id, note: string): Promise<Approval> {
    return decode.approval(await api.post<WireApproval>(`/approvals/${id}/approve/`, { note }))
  },
  async reject(id: Id, note: string): Promise<Approval> {
    return decode.approval(await api.post<WireApproval>(`/approvals/${id}/reject/`, { note }))
  },
  async pendingCount(branch: Id | null): Promise<number> {
    const page = await api.get<Paginated<WireApproval>>('/approvals/', {
      query: { status: 'pending', pageSize: 1, branch },
    })
    return page.count
  },
}
