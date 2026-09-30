import { toDecimal } from '@/lib/money'
import type { AccountEnquiry, Transaction, TransferRequest, TransferResponse } from '@/types'
import { api } from './client'
import type { Wire } from './decode'
import { decode, type WireApproval } from './decoders'

type WireTransfer =
  | { status: 'posted'; debit: Wire<Transaction>; credit: Wire<Transaction> }
  | { status: 'pending_approval'; approval: WireApproval }

export const transfersApi = {
  /** Who owns an account number, before money is sent to it. Any branch. */
  nameEnquiry: (accountNumber: string) =>
    api.get<AccountEnquiry>('/transfers/name-enquiry/', { query: { accountNumber } }),

  async create(input: TransferRequest): Promise<TransferResponse> {
    const res = await api.post<WireTransfer>('/transfers/', {
      ...input,
      amount: toDecimal(input.amount),
    })
    return res.status === 'posted'
      ? {
          status: 'posted',
          debit: decode.transaction(res.debit),
          credit: decode.transaction(res.credit),
        }
      : { status: 'pending_approval', approval: decode.approval(res.approval) }
  },
}
