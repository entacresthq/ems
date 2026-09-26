import { HttpResponse, type JsonBodyType } from 'msw'
import { config } from '@/config'
import { keysToCamel, keysToSnake } from '@/lib/case'
import { hasPermission, ROLE_PERMISSIONS } from '@/lib/permissions'
import { parseDecimal, toDecimal, type Kobo } from '@/lib/money'
import type { AuthUser, Permission } from '@/types'
import { db } from './db'
import { platform } from './platform'
import type { StaffRecord } from './seed/generate'

/** Absolute URL pattern for a handler, e.g. api('/customers/:id/'). */
export function api(path: string): string {
  const base = new URL(config.apiBaseUrl + '/', globalThis.location?.origin ?? 'http://localhost')
  return new URL(path.replace(/^\//, ''), base).toString()
}

// ── Tokens ────────────────────────────────────────────────────────────────
// A readable JSON body plus a signature. The demo's signature is a placeholder;
// the desktop server signs with HMAC-SHA256 (see platform.ts). The Django
// backend will use simplejwt.

const ACCESS_TTL_S = 5 * 60
export const REFRESH_TTL_S = 12 * 60 * 60
export const REFRESH_COOKIE = 'ems_refresh'

function encode(payload: object): string {
  return btoa(JSON.stringify(payload)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function decode<T>(token: string): T | null {
  try {
    const padded = token.replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(padded)) as T
  } catch {
    return null
  }
}

interface TokenPayload {
  sub: string
  exp: number
  typ: 'access' | 'refresh'
}

const nowS = () => Math.floor(Date.now() / 1000)

function signed(payload: TokenPayload): string {
  const body = encode(payload)
  return `ems.${body}.${platform().sign(body)}`
}

/** The token's payload, if its signature checks out. */
function verified(token: string): TokenPayload | null {
  const [, body = '', signature = ''] = token.split('.')
  if (!body || platform().sign(body) !== signature) return null
  return decode<TokenPayload>(body)
}

export function issueAccess(userId: string): string {
  return signed({ sub: userId, exp: nowS() + ACCESS_TTL_S, typ: 'access' })
}

export function issueRefresh(userId: string): string {
  return signed({ sub: userId, exp: nowS() + REFRESH_TTL_S, typ: 'refresh' })
}

export function readRefresh(token: string | undefined): StaffRecord | null {
  if (!token) return null
  const payload = verified(token)
  if (!payload || payload.typ !== 'refresh' || payload.exp < nowS()) return null
  return activeStaff(payload.sub)
}

function activeStaff(id: string): StaffRecord | null {
  const staff = db().staff.find((s) => s.id === id)
  return staff && staff.status === 'active' ? staff : null
}

/** Resolve the Bearer token to a staff member, or return a 401 response. */
export function authenticate(request: Request): StaffRecord | Response {
  const header = request.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  const payload = verified(token)
  const staff =
    payload && payload.typ === 'access' && payload.exp >= nowS() ? activeStaff(payload.sub) : null
  if (!staff) {
    return HttpResponse.json(
      { detail: 'Given token not valid for any token type', code: 'token_not_valid' },
      { status: 401 },
    )
  }
  return staff
}

/**
 * What someone may do: the permissions assigned to them, limited to what their role
 * allows now. The MD always has everything the role allows.
 */
export function effectivePermissions(staff: StaffRecord): Permission[] {
  const available = db().settings?.rolePermissions[staff.role] ?? ROLE_PERMISSIONS[staff.role]
  if (staff.role === 'md') return [...available]
  return available.filter((p) => staff.permissions.includes(p))
}

export function toAuthUser(staff: StaffRecord): AuthUser {
  return {
    id: staff.id,
    staffId: staff.staffId,
    firstName: staff.firstName,
    lastName: staff.lastName,
    email: staff.email,
    phone: staff.phone,
    role: staff.role,
    branchId: staff.branchId,
    branchName: staff.branchName,
    mustChangePassword: staff.mustChangePassword,
    permissions: effectivePermissions(staff),
    lastLoginAt: staff.lastLoginAt,
  }
}

// ── Scoping ───────────────────────────────────────────────────────────────

/** Officers see their own customers, branch staff their branch, head office everything. */
export function scopeRows<T extends { branchId: string; officerId?: string | null }>(
  staff: StaffRecord,
  rows: T[],
): T[] {
  if (staff.role === 'account_officer') return rows.filter((r) => r.officerId === staff.id)
  if (hasPermission(toAuthUser(staff), 'branches.all')) return rows
  return rows.filter((r) => r.branchId === staff.branchId)
}

export function forbidden(message = "You don't have permission to do this.") {
  return HttpResponse.json({ detail: message, code: 'permission_denied' }, { status: 403 })
}

export function notFound() {
  return HttpResponse.json({ detail: 'Not found.', code: 'not_found' }, { status: 404 })
}

export function validationError(errors: Record<string, unknown>) {
  return HttpResponse.json(keysToSnake(errors) as Record<string, unknown>, { status: 400 })
}

// ── Serialisation ─────────────────────────────────────────────────────────

/** Mimic a DRF serializer: money as decimal strings, keys in snake_case. */
export function serialize<T extends object>(
  item: T,
  moneyKeys: readonly (keyof T)[] = [],
): JsonBodyType {
  const out: Record<string, unknown> = { ...(item as Record<string, unknown>) }
  for (const key of moneyKeys) {
    const value = out[key as string]
    if (typeof value === 'number') out[key as string] = toDecimal(value as Kobo)
  }
  return keysToSnake(out) as JsonBodyType
}

// ── Lists ─────────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

export function filterBySearch<T>(
  rows: T[],
  term: string | null,
  fields: ((row: T) => string | null)[],
): T[] {
  const q = term?.trim().toLowerCase()
  if (!q) return rows
  return rows.filter((row) => fields.some((f) => f(row)?.toLowerCase().includes(q)))
}

export function applyOrdering<T>(
  rows: T[],
  ordering: string | null,
  allowed: readonly string[],
): T[] {
  if (!ordering) return rows
  const desc = ordering.startsWith('-')
  const field = ordering.replace(/^-/, '')
  if (!allowed.includes(field)) return rows
  const key = field.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
  return [...rows].sort((a, b) => {
    const av = (a as Record<string, unknown>)[key]
    const bv = (b as Record<string, unknown>)[key]
    const cmp =
      typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av ?? '').localeCompare(String(bv ?? ''), 'en', { sensitivity: 'base' })
    return desc ? -cmp : cmp
  })
}

export function paginate<T>(request: Request, rows: T[], toJson: (row: T) => unknown) {
  const url = new URL(request.url)
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(url.searchParams.get('page_size')) || DEFAULT_PAGE_SIZE),
  )
  const lastPage = Math.max(1, Math.ceil(rows.length / pageSize))
  const page = Number(url.searchParams.get('page') ?? '1')
  if (!Number.isInteger(page) || page < 1 || page > lastPage) {
    return HttpResponse.json({ detail: 'Invalid page.' }, { status: 404 })
  }
  const link = (p: number) => {
    const next = new URL(url)
    next.searchParams.set('page', String(p))
    return next.toString()
  }
  return HttpResponse.json({
    count: rows.length,
    next: page < lastPage ? link(page + 1) : null,
    previous: page > 1 ? link(page - 1) : null,
    results: rows.slice((page - 1) * pageSize, page * pageSize).map(toJson),
  })
}

// ── Request helpers ───────────────────────────────────────────────────────

export function can(staff: StaffRecord, permission: Permission): boolean {
  return hasPermission(toAuthUser(staff), permission)
}

export function inScope<T extends { branchId: string; officerId?: string | null }>(
  staff: StaffRecord,
  row: T,
): boolean {
  return scopeRows(staff, [row]).length > 0
}

/** JSON body with keys converted to camelCase. */
export async function readBody<T = Record<string, unknown>>(request: Request): Promise<Partial<T>> {
  try {
    return keysToCamel(await request.json()) as Partial<T>
  } catch {
    return {}
  }
}

/** Parse a positive decimal amount from a request body; null when invalid. */
export function parseMoney(value: unknown): Kobo | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  try {
    const amount = parseDecimal(String(value))
    return amount > 0 ? amount : null
  } catch {
    return null
  }
}

export function badRequest(detail: string, code = 'invalid') {
  return HttpResponse.json({ detail, code }, { status: 400 })
}

export function conflict(detail: string) {
  return HttpResponse.json({ detail, code: 'conflict' }, { status: 409 })
}

export function param(request: Request, key: string): string | null {
  return new URL(request.url).searchParams.get(key)
}
