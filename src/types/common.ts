/** DRF PageNumberPagination envelope. */
export interface Paginated<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

export interface ListParams {
  page?: number
  pageSize?: number
  search?: string
  /** DRF OrderingFilter value, e.g. "last_name" or "-created_at". */
  ordering?: string
}

/** ISO 8601 timestamp with offset, e.g. "2026-09-25T14:05:00+01:00". */
export type IsoDateTime = string
/** Calendar date, e.g. "2026-09-25". */
export type IsoDate = string

export type Id = string

export interface GeoPoint {
  lat: number
  lng: number
  accuracyM: number | null
}
