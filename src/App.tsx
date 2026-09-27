import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { ToastProvider } from '@/components/ui/Toast'
import { config } from '@/config'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { SetupGate } from '@/features/setup/SetupGate'
import { UpdatePrompt } from '@/features/pwa/UpdatePrompt'
import { queryClient } from '@/lib/queryClient'
import { router } from '@/routes/router'

function Session() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        {config.emsServer ? (
          <SetupGate>
            <Session />
          </SetupGate>
        ) : (
          <Session />
        )}
        {/* No service worker while MSW's worker is active, or in the desktop app, which
            updates by installer. Web deployments get it, so the field app works offline. */}
        {!config.useMocks && !config.desktop && import.meta.env.PROD && <UpdatePrompt />}
      </ToastProvider>
    </QueryClientProvider>
  )
}
