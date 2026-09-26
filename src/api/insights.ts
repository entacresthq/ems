import { parseDecimal } from '@/lib/money'
import type { Dashboard, Id, OfficerPerformance, ReportQuery, ReportResult } from '@/types'
import { api } from './client'

/**
 * Dashboards carry many amounts in nested shapes. Rather than a type-level
 * wire mirror for each, decode every decimal-string field named in MONEY.
 */
const MONEY = new Set([
  'expected',
  'collected',
  'cash',
  'transfer',
  'counted',
  'variance',
  'portfolio',
  'par1',
  'par7',
  'par30',
  'disbursedTodayAmount',
  'disbursedMonthAmount',
  'deposits',
  'withdrawals',
  'repayments',
  'interest',
  'fees',
  'penalties',
  'commissions',
  'total',
])

function decodeMoneyDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeMoneyDeep)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        MONEY.has(k) && typeof v === 'string' ? parseDecimal(v) : decodeMoneyDeep(v),
      ]),
    )
  }
  return value
}

export const insightKeys = {
  dashboard: (branch: Id | null) => ['dashboard', branch] as const,
  performance: () => ['field', 'performance'] as const,
  report: (key: string, query: ReportQuery) => ['reports', key, query] as const,
}

export const insightsApi = {
  async dashboard(branch: Id | null): Promise<Dashboard> {
    return decodeMoneyDeep(
      await api.get<unknown>('/dashboard/', { query: { branch } }),
    ) as Dashboard
  },
  async performance(): Promise<OfficerPerformance> {
    return decodeMoneyDeep(await api.get<unknown>('/field/performance/')) as OfficerPerformance
  },
  /** Report rows keep money as decimal strings; columns say which cells are money. */
  report: (key: string, query: ReportQuery) =>
    api.get<ReportResult>(`/reports/${key}/`, { query: { ...query } }),
}
