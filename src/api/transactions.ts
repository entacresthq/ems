import { toDecimal } from '@/lib/money'
import type {
  Approval,
  CounterPostingRequest,
  CounterPostingResponse,
  Id,
  Paginated,
  Transaction,
  TransactionListParams,
} from '@/types'
import { api } from './client'
import { decodePage, type Wire } from './decode'
import { decode, type WireApproval } from './decoders'

export const transactionKeys = {
  all: ['transactions'] as const,
  list: (params: TransactionListParams) => [...transactionKeys.all, 'list', params] as const,
  detail: (id: Id) => [...transactionKeys.all, 'detail', id] as const,
}

type WirePosting =
  | { status: 'posted'; transaction: Wire<Transaction> }
  | { status: 'pending_approval'; approval: WireApproval }

export const transactionsApi = {
  async list(params: TransactionListParams): Promise<Paginated<Transaction>> {
    const page = await api.get<Paginated<Wire<Transaction>>>('/transactions/', {
      query: { ...params },
    })
    return decodePage(page, decode.transaction)
  },
  async get(id: Id): Promise<Transaction> {
    return decode.transaction(await api.get<Wire<Transaction>>(`/transactions/${id}/`))
  },
  async post(body: CounterPostingRequest): Promise<CounterPostingResponse> {
    const res = await api.post<WirePosting>('/transactions/', {
      ...body,
      amount: toDecimal(body.amount),
    })
    return res.status === 'posted'
      ? { status: 'posted', transaction: decode.transaction(res.transaction) }
      : { status: 'pending_approval', approval: decode.approval(res.approval) }
  },
  async requestReversal(id: Id, reason: string): Promise<Approval> {
    return decode.approval(
      await api.post<WireApproval>(`/transactions/${id}/reversal-request/`, { reason }),
    )
  },
}
