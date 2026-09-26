import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * List state (page, size, sort, search, filters) kept in the URL, so filtered
 * views can be bookmarked and shared, and Back returns to the same view.
 */
export function useListParams<K extends string>(
  filterKeys: readonly K[],
  defaults: { ordering?: string; pageSize?: number; filters?: Partial<Record<K, string>> } = {},
) {
  const [params, setParams] = useSearchParams()

  const page = Math.max(1, Number(params.get('page')) || 1)
  const pageSize = Number(params.get('page_size')) || defaults.pageSize || 25
  const ordering = params.get('ordering') ?? defaults.ordering
  const search = params.get('search') ?? ''

  const filterValues = filterKeys.map((k) => params.get(k) ?? defaults.filters?.[k] ?? '').join('|')
  const filters = useMemo(() => {
    const values = filterValues.split('|')
    return Object.fromEntries(filterKeys.map((k, i) => [k, values[i] || undefined])) as Partial<
      Record<K, string>
    >
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterValues])

  const update = useCallback(
    (changes: Record<string, string | number | undefined | null>, resetPage = true) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(changes)) {
            if (value === undefined || value === null || value === '') next.delete(key)
            else next.set(key, String(value))
          }
          if (resetPage && !('page' in changes)) next.delete('page')
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  return {
    page,
    pageSize,
    ordering,
    search,
    filters,
    setPage: (p: number) => update({ page: p === 1 ? undefined : p }, false),
    setPageSize: (s: number) => update({ page_size: s }),
    setOrdering: (o: string | undefined) => update({ ordering: o ?? '' }),
    setSearch: (s: string) => update({ search: s }),
    setFilter: (key: K, value: string | undefined) => update({ [key]: value }),
    clearFilters: () =>
      update(Object.fromEntries([...filterKeys, 'search'].map((k) => [k, undefined]))),
    hasFilters: search !== '' || filterKeys.some((k) => params.get(k)),
  }
}
