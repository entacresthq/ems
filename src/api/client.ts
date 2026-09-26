import { apiUrl } from '@/config'
import { keysToCamel, keysToSnake } from '@/lib/case'

/**
 * Typed fetch wrapper for the DRF backend.
 *
 * - JSON bodies are sent snake_case and returned camelCase.
 * - The access token lives in memory only. The refresh token is an httpOnly
 *   cookie set by the backend, so requests use `credentials: 'include'`.
 * - A 401 triggers one token refresh (shared by concurrent requests), then a retry.
 */

export type FieldErrors = Record<string, string[]>

/** Fired on window when the desktop server refuses a request for want of a licence. */
export const LICENCE_REQUIRED_EVENT = 'ems:licence-required'

export class ApiError extends Error {
  readonly status: number
  /** Field-level errors keyed by camelCase path, e.g. "nextOfKin.phone". */
  readonly fieldErrors: FieldErrors
  /** Errors not tied to a field (DRF `detail` / `non_field_errors`). */
  readonly formErrors: string[]
  readonly code: string | undefined

  constructor(
    status: number,
    message: string,
    options: Partial<Pick<ApiError, 'fieldErrors' | 'formErrors' | 'code'>> = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.fieldErrors = options.fieldErrors ?? {}
    this.formErrors = options.formErrors ?? []
    this.code = options.code
  }

  get isNetworkError() {
    return this.status === 0
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

const DEFAULT_MESSAGES: Record<number, string> = {
  0: "Can't reach the server. Check your internet connection and try again.",
  400: 'Some details need fixing. Check the highlighted fields.',
  401: 'Your session has ended. Sign in again to continue.',
  403: "You don't have permission to do this. Ask your branch manager if you need access.",
  404: "We couldn't find that record. It may have been removed.",
  409: 'This record changed while you were working on it. Reload and try again.',
  429: 'Too many attempts. Wait a minute, then try again.',
}

function defaultMessage(status: number): string {
  return (
    DEFAULT_MESSAGES[status] ??
    'Something went wrong on our side. Try again in a moment, and contact support if it keeps happening.'
  )
}

// ── Access token (memory only) ────────────────────────────────────────────

let accessToken: string | null = null

export const tokenStore = {
  get: () => accessToken,
  set: (token: string | null) => {
    accessToken = token
  },
}

let sessionExpiredHandler: (() => void) | null = null

/** Called when a refresh fails with 401, i.e. the session is truly over. */
export function onSessionExpired(handler: (() => void) | null) {
  sessionExpiredHandler = handler
}

// ── Error parsing ─────────────────────────────────────────────────────────

function flattenFieldErrors(value: unknown, prefix: string, out: FieldErrors) {
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === 'string')) {
      out[prefix] = value as string[]
    } else {
      value.forEach((item, index) => flattenFieldErrors(item, `${prefix}.${index}`, out))
    }
  } else if (typeof value === 'string') {
    out[prefix] = [value]
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      flattenFieldErrors(nested, prefix ? `${prefix}.${key}` : key, out)
    }
  }
}

function toApiError(status: number, body: unknown): ApiError {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return new ApiError(status, defaultMessage(status))
  }
  const { detail, nonFieldErrors, ...rest } = body as Record<string, unknown>
  // DRF puts a string error code beside `detail`; a list under `code` is a field error.
  const code = typeof rest.code === 'string' ? rest.code : undefined
  if (code !== undefined) delete rest.code
  const formErrors: string[] = []
  if (typeof detail === 'string') formErrors.push(detail)
  if (Array.isArray(nonFieldErrors)) formErrors.push(...nonFieldErrors.map(String))
  const fieldErrors: FieldErrors = {}
  flattenFieldErrors(rest, '', fieldErrors)
  const message = formErrors[0] ?? defaultMessage(status)
  return new ApiError(status, message, {
    fieldErrors,
    formErrors,
    code,
  })
}

// ── Requests ──────────────────────────────────────────────────────────────

export type QueryValue = string | number | boolean | null | undefined
export type Query = Record<string, QueryValue>

export interface RequestOptions {
  query?: Query
  body?: unknown
  signal?: AbortSignal
  /** Set false for endpoints that must not send or refresh the access token. */
  auth?: boolean
  headers?: Record<string, string>
}

function buildUrl(path: string, query?: Query): string {
  const url = new URL(apiUrl(path))
  if (query) {
    const snake = keysToSnake(query) as Query
    for (const [key, value] of Object.entries(snake)) {
      if (value === undefined || value === null || value === '') continue
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

async function rawFetch(method: string, path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers }
  let body: BodyInit | undefined
  if (options.body instanceof FormData) {
    body = options.body
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(keysToSnake(options.body))
  }
  const token = tokenStore.get()
  if (options.auth !== false && token) headers.Authorization = `Bearer ${token}`

  try {
    return await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body,
      signal: options.signal,
      credentials: 'include',
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, defaultMessage(0))
  }
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined
  const text = await response.text()
  if (!text) return undefined
  try {
    return keysToCamel(JSON.parse(text))
  } catch {
    return undefined
  }
}

let refreshInFlight: Promise<string | null> | null = null

/**
 * Exchange the refresh cookie for a new access token. Resolves null when the
 * session is over; throws ApiError(0) when the network is unavailable.
 */
export function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= (async () => {
    try {
      const response = await rawFetch('POST', '/auth/token/refresh/', { auth: false })
      if (!response.ok) {
        tokenStore.set(null)
        return null
      }
      const data = (await parseBody(response)) as { access: string }
      tokenStore.set(data.access)
      return data.access
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

export async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  let response = await rawFetch(method, path, options)

  if (response.status === 401 && options.auth !== false) {
    const token = await refreshAccessToken()
    if (!token) {
      sessionExpiredHandler?.()
      throw new ApiError(401, defaultMessage(401))
    }
    response = await rawFetch(method, path, options)
  }

  const body = await parseBody(response)
  if (!response.ok) {
    const error = toApiError(response.status, body)
    // The desktop app locks itself when its licence is missing or has ended.
    if (error.code === 'licence_required') window.dispatchEvent(new Event(LICENCE_REQUIRED_EVENT))
    throw error
  }
  return body as T
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PATCH', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PUT', path, { ...options, body }),
  delete: <T = void>(path: string, options?: RequestOptions) => request<T>('DELETE', path, options),
}
