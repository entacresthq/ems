import { parseDecimal, toDecimal, type Kobo } from '@/lib/money'
import type {
  Approval,
  Id,
  Loan,
  LoanApplicationInput,
  LoanDetail,
  LoanListParams,
  LoanProduct,
  Paginated,
  PaymentMethod,
} from '@/types'
import { api } from './client'
import { decodePage } from './decode'
import {
  decode,
  type WireApproval,
  type WireLoan,
  type WireLoanDetail,
  type WireLoanProduct,
} from './decoders'

export const loanKeys = {
  all: ['loans'] as const,
  list: (params: LoanListParams) => [...loanKeys.all, 'list', params] as const,
  detail: (id: Id) => [...loanKeys.all, 'detail', id] as const,
}

export const loanProductKeys = {
  all: ['loan-products'] as const,
  list: (status?: LoanProduct['status']) => [...loanProductKeys.all, status ?? 'all'] as const,
}

export type LoanProductInput = Omit<LoanProduct, 'id' | 'code'>

const encodeProduct = (p: Partial<LoanProductInput>) => ({
  ...p,
  minAmount: p.minAmount === undefined ? undefined : toDecimal(p.minAmount),
  maxAmount: p.maxAmount === undefined ? undefined : toDecimal(p.maxAmount),
  processingFee:
    p.processingFee?.type === 'flat'
      ? { type: 'flat', amount: toDecimal(p.processingFee.amount) }
      : p.processingFee,
  penalty:
    p.penalty?.type === 'flat'
      ? { ...p.penalty, amountPerDay: toDecimal(p.penalty.amountPerDay) }
      : p.penalty,
})

export const loansApi = {
  async list(params: LoanListParams): Promise<Paginated<Loan>> {
    const page = await api.get<Paginated<WireLoan>>('/loans/', { query: { ...params } })
    return decodePage(page, decode.loan)
  },
  async get(id: Id): Promise<LoanDetail> {
    return decode.loanDetail(await api.get<WireLoanDetail>(`/loans/${id}/`))
  },
  async apply(input: LoanApplicationInput): Promise<Loan> {
    const body = {
      ...input,
      principal: toDecimal(input.principal),
      collateral: input.collateral.map((c) => ({
        ...c,
        estimatedValue: toDecimal(c.estimatedValue),
      })),
    }
    return decode.loan(await api.post<WireLoan>('/loans/', body))
  },
  async disburse(id: Id, paymentMethod: PaymentMethod): Promise<{ loan: Loan; payout: Kobo }> {
    const res = await api.post<{ loan: WireLoan; payout: string }>(`/loans/${id}/disburse/`, {
      paymentMethod,
    })
    return { loan: decode.loan(res.loan), payout: parseDecimal(res.payout) }
  },
  async requestExtension(id: Id, extraInstallments: number, reason: string): Promise<Approval> {
    return decode.approval(
      await api.post<WireApproval>(`/loans/${id}/extension-request/`, {
        extraInstallments,
        reason,
      }),
    )
  },
  async chargePenalty(id: Id): Promise<Loan> {
    return decode.loan(await api.post<WireLoan>(`/loans/${id}/charge-penalty/`))
  },
}

export const loanProductsApi = {
  async list(status?: LoanProduct['status']): Promise<Paginated<LoanProduct>> {
    const page = await api.get<Paginated<WireLoanProduct>>('/loan-products/', {
      query: { pageSize: 100, status },
    })
    return decodePage(page, decode.loanProduct)
  },
  async create(input: LoanProductInput): Promise<LoanProduct> {
    return decode.loanProduct(
      await api.post<WireLoanProduct>('/loan-products/', encodeProduct(input)),
    )
  },
  async update(id: Id, input: Partial<LoanProductInput>): Promise<LoanProduct> {
    return decode.loanProduct(
      await api.patch<WireLoanProduct>(`/loan-products/${id}/`, encodeProduct(input)),
    )
  },
}
