import type { AuthUser } from '@/types'

/**
 * The field app keeps the officer's profile on the phone so it can open and
 * unlock with the PIN when there is no network. Back-office users are never cached.
 */
const KEY = 'ems:field-user'

export function cacheFieldUser(user: AuthUser) {
  try {
    localStorage.setItem(KEY, JSON.stringify(user))
  } catch {
    // Storage full or blocked: offline start will not be available.
  }
}

export function readCachedFieldUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

export function clearCachedFieldUser() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
