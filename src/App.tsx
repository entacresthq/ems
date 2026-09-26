import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { ToastProvider } from '@/components/ui/Toast'
import { config } from '@/config'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { UpdatePrompt } from '@/features/pwa/UpdatePrompt'
import { queryClient } from '@/lib/queryClient'
import { router } from '@/routes/router'

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
        {/* The app's service worker is not registered while MSW's worker is active. */}
        {!config.useMocks && import.meta.env.PROD && <UpdatePrompt />}
      </ToastProvider>
    </QueryClientProvider>
  )
}
