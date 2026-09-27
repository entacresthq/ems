import { useQuery } from '@tanstack/react-query'
import { systemApi, systemKeys, type SystemStatus } from '@/api/system'
import { config } from '@/config'

/** Licence, workspace and delivery details of the EMS server; undefined in the browser demo. */
export function useSystemStatus(): SystemStatus | undefined {
  return useQuery({
    queryKey: systemKeys.status,
    queryFn: systemApi.status,
    staleTime: Infinity,
    enabled: config.emsServer,
  }).data
}

/** Sample data with the demo accounts: the browser demo, or a server's demo workspace. */
export function useIsDemo(): boolean {
  const status = useSystemStatus()
  return config.useMocks || status?.mode === 'demo'
}
