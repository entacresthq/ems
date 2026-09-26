import { cn } from '@/lib/cn'

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const TONES: Record<Tone, { box: string; dot: string }> = {
  neutral: { box: 'bg-ink-tint text-ink-2', dot: 'bg-ink-3' },
  success: { box: 'bg-ledger-tint text-ledger-strong', dot: 'bg-ledger' },
  warning: { box: 'bg-ochre-tint text-ochre', dot: 'bg-ochre' },
  danger: { box: 'bg-brick-tint text-brick-strong', dot: 'bg-brick' },
  info: { box: 'bg-surface text-ink border border-rule', dot: 'bg-ink' },
}

/** Dot + text so meaning never depends on colour alone. */
export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone
  children: React.ReactNode
  className?: string
}) {
  const t = TONES[tone]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        t.box,
        className,
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', t.dot)} aria-hidden />
      {children}
    </span>
  )
}

/** Labels and tones for every status the API returns. */
const STATUS_MAP: Record<string, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'success' },
  inactive: { label: 'Inactive', tone: 'neutral' },
  pending_approval: { label: 'Awaiting approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  blacklisted: { label: 'Blacklisted', tone: 'danger' },
  dormant: { label: 'Dormant', tone: 'warning' },
  frozen: { label: 'Frozen', tone: 'info' },
  closed: { label: 'Closed', tone: 'neutral' },
  suspended: { label: 'Suspended', tone: 'warning' },
  deactivated: { label: 'Deactivated', tone: 'neutral' },
  written_off: { label: 'Written off', tone: 'danger' },
  posted: { label: 'Posted', tone: 'success' },
  pending_reversal: { label: 'Reversal pending', tone: 'warning' },
  reversed: { label: 'Reversed', tone: 'neutral' },
  retired: { label: 'Retired', tone: 'neutral' },
  pending_sync: { label: 'Waiting to sync', tone: 'warning' },
  synced: { label: 'Synced', tone: 'success' },
  overdue: { label: 'Overdue', tone: 'danger' },
  in_arrears: { label: 'In arrears', tone: 'danger' },
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const entry = STATUS_MAP[status] ?? {
    label: status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
    tone: 'neutral' as const,
  }
  return (
    <Badge tone={entry.tone} className={className}>
      {entry.label}
    </Badge>
  )
}
