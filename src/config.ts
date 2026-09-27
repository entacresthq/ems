const rawBase = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

export const config = {
  /** API base without a trailing slash; may be relative to the page origin. */
  apiBaseUrl: rawBase.replace(/\/+$/, ''),
  useMocks: import.meta.env.VITE_USE_MOCKS === 'true',
  /** Built into the licensed desktop app, talking to its local server. */
  desktop: import.meta.env.VITE_DESKTOP === 'true',
  /** Served by an EMS server (web or desktop): licence, set-up and /system/ endpoints. */
  emsServer: import.meta.env.VITE_EMS_SERVER === 'true' || import.meta.env.VITE_DESKTOP === 'true',
  /** Back office signs staff out after this much inactivity. */
  backOfficeIdleMs: 15 * 60 * 1000,
  /** Warning shown this long before the idle sign-out. */
  idleWarningMs: 60 * 1000,
  /** Field app locks behind the PIN after this much inactivity. */
  fieldLockMs: 5 * 60 * 1000,
  pinLength: 6,
  maxPinAttempts: 5,
} as const

/** Absolute URL for an API path such as `/customers/`. */
export function apiUrl(path: string): string {
  const base = new URL(config.apiBaseUrl + '/', window.location.origin)
  return new URL(path.replace(/^\//, ''), base).toString()
}
