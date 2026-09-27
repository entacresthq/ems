import { useEffect } from 'react'
import { systemKeys, type SystemStatus } from '@/api/system'
import { queryClient } from '@/lib/queryClient'

export function useDocumentTitle(title: string) {
  useEffect(() => {
    // The set-up gate loads the server status before any page shows.
    const demo = queryClient.getQueryData<SystemStatus>(systemKeys.status)?.mode === 'demo'
    document.title = `${title} · EMS${demo ? ' demo' : ''}`
  }, [title])
}
