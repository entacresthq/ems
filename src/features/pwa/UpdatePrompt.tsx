import { useRegisterSW } from 'virtual:pwa-register/react'
import { Button } from '@/components/ui/Button'

/**
 * Registers the service worker and offers a reload when a new version is
 * ready. It never reloads on its own, so an officer mid-collection is not interrupted.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div
      role="status"
      className="border-ledger bg-surface shadow-overlay fixed inset-x-4 bottom-20 z-50 mx-auto flex max-w-md items-center gap-3 border-l-4 px-4 py-3 sm:bottom-4"
    >
      <p className="flex-1 text-sm">A new version of the app is ready.</p>
      <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)}>
        Later
      </Button>
      <Button size="sm" variant="primary" onClick={() => void updateServiceWorker(true)}>
        Update now
      </Button>
    </div>
  )
}
