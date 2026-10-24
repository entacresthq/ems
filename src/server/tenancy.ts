import { AsyncLocalStorage } from 'node:async_hooks'
import { setDbScope, type DbScope } from '@/mocks/db'
import { setPlatformScope, type Platform } from '@/mocks/platform'

/**
 * When one server holds several businesses (hub.ts), each request runs inside
 * its business's scope. The business rules (src/mocks/handlers) read the data
 * through db() and the live behaviour through platform(); both return the
 * current request's business, so the rules themselves need no changes.
 */

export interface BusinessScope extends DbScope {
  platform: Platform
}

const current = new AsyncLocalStorage<BusinessScope>()
let installed = false

/** Route db() and platform() to the current request's business. Once per process. */
export function installBusinessScopes() {
  if (installed) return
  installed = true
  setDbScope(() => current.getStore())
  setPlatformScope(() => current.getStore()?.platform)
}

/** Run `fn`, and everything it awaits, as `scope`'s business. */
export function inBusiness<T>(scope: BusinessScope, fn: () => T): T {
  return current.run(scope, fn)
}
