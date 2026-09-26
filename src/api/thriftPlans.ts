import { toDecimal } from '@/lib/money'
import type { Id, Paginated, ThriftPlan, ThriftPlanInput } from '@/types'
import { api } from './client'
import { decodePage } from './decode'
import { decode, type WireThriftPlan } from './decoders'

export const thriftPlanKeys = {
  all: ['thrift-plans'] as const,
  list: (status?: ThriftPlan['status']) =>
    [...thriftPlanKeys.all, 'list', status ?? 'all'] as const,
}

function encode(input: Partial<ThriftPlanInput>) {
  return {
    ...input,
    contributionAmount:
      input.contributionAmount === undefined ? undefined : toDecimal(input.contributionAmount),
    commission:
      input.commission?.type === 'flat'
        ? { type: 'flat', amount: toDecimal(input.commission.amount) }
        : input.commission,
  }
}

export const thriftPlansApi = {
  async list(status?: ThriftPlan['status']): Promise<Paginated<ThriftPlan>> {
    const page = await api.get<Paginated<WireThriftPlan>>('/thrift-plans/', {
      query: { pageSize: 100, status },
    })
    return decodePage(page, decode.thriftPlan)
  },
  async create(input: ThriftPlanInput): Promise<ThriftPlan> {
    return decode.thriftPlan(await api.post<WireThriftPlan>('/thrift-plans/', encode(input)))
  },
  async update(id: Id, input: Partial<ThriftPlanInput>): Promise<ThriftPlan> {
    return decode.thriftPlan(await api.patch<WireThriftPlan>(`/thrift-plans/${id}/`, encode(input)))
  },
}
