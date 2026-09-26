import { setupWorker } from 'msw/browser'
import { config } from '@/config'
import { initMockDb } from './db'
import { handlers } from './handlers'

export const worker = setupWorker(...handlers)

export async function startMockWorker() {
  await initMockDb()
  await worker.start({
    quiet: true,
    onUnhandledRequest(request, print) {
      // Only warn about API calls that have no mock; ignore assets and fonts.
      if (request.url.includes(config.apiBaseUrl)) print.warning()
    },
  })
}
