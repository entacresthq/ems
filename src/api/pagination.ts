import type { Paginated } from '@/types'

/** Fetch every page (for exports). Stops at `max` rows to protect the browser. */
export async function fetchAll<T>(
  fetchPage: (page: number) => Promise<Paginated<T>>,
  max = 5000,
): Promise<T[]> {
  const rows: T[] = []
  for (let page = 1; rows.length < max; page++) {
    const result = await fetchPage(page)
    rows.push(...result.results)
    if (!result.next) break
  }
  return rows.slice(0, max)
}
