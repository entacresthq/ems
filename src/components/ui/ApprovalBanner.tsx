import type { ReactNode } from 'react'
import { formatDateTime } from '@/lib/dates'
import { cn } from '@/lib/cn'

export type ApprovalState = 'pending' | 'approved' | 'rejected'

export interface ApprovalBannerProps {
  state: ApprovalState
  /** What is being approved, e.g. "Reversal of EMS26092500041". */
  subject: string
  requestedBy: string
  requestedAt: string
  decidedBy?: string
  decidedAt?: string
  reason?: string
  /** Approve / reject buttons, shown only to people who can decide. */
  actions?: ReactNode
}

const STATE = {
  pending: { box: 'border-ochre bg-ochre-tint', label: 'Awaiting approval' },
  approved: { box: 'border-ledger bg-ledger-tint', label: 'Approved' },
  rejected: { box: 'border-brick bg-brick-tint', label: 'Rejected' },
}

/** Maker-checker status for a record: who asked, who decided, and why. */
export function ApprovalBanner({
  state,
  subject,
  requestedBy,
  requestedAt,
  decidedBy,
  decidedAt,
  reason,
  actions,
}: ApprovalBannerProps) {
  const s = STATE[state]
  return (
    <section
      aria-label="Approval status"
      className={cn(
        'flex flex-col gap-3 border-l-4 px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
        s.box,
      )}
    >
      <div className="text-sm">
        <p className="text-ink font-semibold">
          {s.label}: {subject}
        </p>
        <p className="text-ink-2 mt-0.5">
          Requested by {requestedBy} on {formatDateTime(requestedAt)}
          {decidedBy && decidedAt && (
            <>
              {' · '}
              {state === 'approved' ? 'Approved' : 'Rejected'} by {decidedBy} on{' '}
              {formatDateTime(decidedAt)}
            </>
          )}
        </p>
        {reason && <p className="text-ink mt-1">Reason: {reason}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </section>
  )
}
