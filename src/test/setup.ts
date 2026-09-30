import '@testing-library/jest-dom/vitest'
// IndexedDB for the field outbox and the mock database.
import 'fake-indexeddb/auto'
import { cleanup, configure } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from '@/mocks/node'

// React Router builds Requests with jsdom's AbortSignal, which Node's fetch
// rejects. Tests don't need navigation cancellation, so drop the signal.
const NodeRequest = globalThis.Request
class TestRequest extends NodeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init?.signal ? { ...init, signal: undefined } : init)
  }
}
globalThis.Request = TestRequest as typeof Request

// Mock handlers add realistic latency; give screens time to settle.
configure({ asyncUtilTimeout: 4000 })

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
  // Absent in tests that run in Node rather than a page (server-only tests).
  globalThis.localStorage?.clear()
  globalThis.sessionStorage?.clear()
})
afterAll(() => server.close())
