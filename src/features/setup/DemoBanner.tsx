import { useSystemStatus } from './useSystemStatus'

/** Always visible in the demo workspace, so training data is never mistaken for real records. */
export function DemoBanner() {
  const status = useSystemStatus()
  if (status?.mode !== 'demo') return null
  return (
    <p
      role="note"
      className="bg-ochre-tint border-ochre text-ink border-b px-4 py-1.5 text-center text-sm print:hidden"
    >
      <strong className="font-semibold">Demo workspace.</strong> Training data only. Nothing you do
      here touches your live records.
    </p>
  )
}

/** Small marker for headers, which stay in view while the page scrolls. */
export function DemoBadge({ onDark = false }: { onDark?: boolean }) {
  const status = useSystemStatus()
  if (status?.mode !== 'demo') return null
  return (
    <span
      className={
        onDark
          ? 'rounded-sm bg-white/15 px-2 py-0.5 text-xs font-semibold text-white'
          : 'bg-ochre-tint text-ochre rounded-sm px-2 py-0.5 text-xs font-semibold'
      }
    >
      Demo workspace
    </span>
  )
}
