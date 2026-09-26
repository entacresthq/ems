import { toDecimal } from '@/lib/money'
import type {
  CollectionRequest,
  CollectionResponse,
  DaySummary,
  FieldToday,
  IsoDate,
  Portfolio,
  Transaction,
} from '@/types'
import { api } from './client'
import type { Wire } from './decode'
import { decode, type WireDaySummary, type WirePortfolio, type WireToday } from './decoders'

export const fieldKeys = {
  all: ['field'] as const,
  today: () => [...fieldKeys.all, 'today'] as const,
  portfolio: () => [...fieldKeys.all, 'portfolio'] as const,
  daySummary: (date: IsoDate) => [...fieldKeys.all, 'day-summary', date] as const,
}

export const fieldApi = {
  async today(): Promise<FieldToday> {
    return decode.today(await api.get<WireToday>('/field/today/'))
  },
  async portfolio(): Promise<Portfolio> {
    return decode.portfolio(await api.get<WirePortfolio>('/field/portfolio/'))
  },
  async daySummary(date: IsoDate): Promise<DaySummary> {
    return decode.daySummary(
      await api.get<WireDaySummary>('/field/day-summary/', { query: { date } }),
    )
  },
  async collect(body: CollectionRequest): Promise<CollectionResponse> {
    const res = await api.post<{
      transaction: Wire<Transaction>
      receipt: CollectionResponse['receipt']
    }>('/collections/', { ...body, amount: toDecimal(body.amount) })
    return { transaction: decode.transaction(res.transaction), receipt: res.receipt }
  },
}
