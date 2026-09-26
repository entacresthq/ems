import { config } from '@/config'

/**
 * 6-digit PIN that unlocks the field app on this phone. Only a salted
 * PBKDF2 hash is stored. It never leaves the device and is not a password:
 * the server session (refresh cookie) is still required to sync.
 */

interface StoredPin {
  salt: string
  hash: string
  iterations: number
  failedAttempts: number
}

const ITERATIONS = 150_000
const key = (userId: string) => `ems:pin:${userId}`

const toBase64 = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(
    String.fromCharCode(
      ...new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)),
    ),
  )
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0))

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    material,
    256,
  )
  return toBase64(bits)
}

function read(userId: string): StoredPin | null {
  try {
    const raw = localStorage.getItem(key(userId))
    return raw ? (JSON.parse(raw) as StoredPin) : null
  } catch {
    return null
  }
}

function write(userId: string, value: StoredPin) {
  localStorage.setItem(key(userId), JSON.stringify(value))
}

export function hasPin(userId: string): boolean {
  return read(userId) !== null
}

export function clearPin(userId: string) {
  try {
    localStorage.removeItem(key(userId))
  } catch {
    // ignore
  }
}

export async function savePin(userId: string, pin: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  write(userId, {
    salt: toBase64(salt),
    hash: await derive(pin, salt, ITERATIONS),
    iterations: ITERATIONS,
    failedAttempts: 0,
  })
}

export type PinCheck = { ok: true } | { ok: false; attemptsLeft: number }

/** Checks the PIN. After too many failures the PIN is erased. */
export async function checkPin(userId: string, pin: string): Promise<PinCheck> {
  const stored = read(userId)
  if (!stored) return { ok: false, attemptsLeft: 0 }
  const hash = await derive(pin, fromBase64(stored.salt), stored.iterations)
  if (hash === stored.hash) {
    if (stored.failedAttempts) write(userId, { ...stored, failedAttempts: 0 })
    return { ok: true }
  }
  const failedAttempts = stored.failedAttempts + 1
  const attemptsLeft = config.maxPinAttempts - failedAttempts
  if (attemptsLeft <= 0) clearPin(userId)
  else write(userId, { ...stored, failedAttempts })
  return { ok: false, attemptsLeft: Math.max(0, attemptsLeft) }
}

/** Rejects PINs that are easy to guess from over someone's shoulder. */
export function pinWeakness(pin: string): string | null {
  if (/^(\d)\1+$/.test(pin)) return 'Avoid using the same digit six times.'
  const digits = pin.split('').map(Number)
  const steps = digits.slice(1).map((d, i) => d - digits[i]!)
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) {
    return 'Avoid digits in order, like 123456 or 654321.'
  }
  return null
}
