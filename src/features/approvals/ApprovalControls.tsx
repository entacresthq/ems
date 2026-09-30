import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { approvalKeys, approvalsApi } from '@/api/operations'
import { ApprovalBanner } from '@/components/ui/ApprovalBanner'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { hasPermission } from '@/lib/permissions'
import { formatNaira } from '@/lib/money'
import { APPROVAL_TYPE_LABELS, type Approval, type ApprovalListParams } from '@/types'

/** Refresh everything an approval can change. */
export function useInvalidateAfterDecision() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all(
      ['approvals', 'customers', 'accounts', 'transactions', 'loans', 'remittances'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    )
}

/**
 * Approve and reject buttons with their confirmation dialogs. Shown only to
 * people who can decide, and never to the person who made the request.
 */
export function ApprovalDecisionButtons({
  approval,
  onDecided,
  size = 'sm',
}: {
  approval: Approval
  onDecided?: (a: Approval) => void
  size?: 'sm' | 'md'
}) {
  const user = useCurrentUser()
  const toast = useToast()
  const invalidate = useInvalidateAfterDecision()
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null)

  if (approval.status !== 'pending' || !hasPermission(user, 'approvals.decide')) return null
  if (approval.requestedById === user.id) {
    return (
      <p className="text-ink-2 text-sm">
        You made this request, so another manager must decide it.
      </p>
    )
  }

  const label = APPROVAL_TYPE_LABELS[approval.type].toLowerCase()
  const consequence: Record<Approval['type'], string> = {
    customer_registration: 'The customer becomes active and their thrift account is opened.',
    transaction_reversal: 'An opposite entry is posted and the balance changes straight away.',
    account_closure: 'The account is closed and can no longer take transactions.',
    large_withdrawal: 'The withdrawal is posted and the cashier can pay out the cash.',
    large_transfer: 'The money moves between the two accounts straight away.',
    loan_application:
      'The loan moves to the cashier to be paid out. The schedule starts on the day it is paid out.',
    loan_extension:
      'The remaining balance is spread over more installments. No extra interest is added.',
  }

  return (
    <>
      <Button size={size} onClick={() => setDialog('reject')}>
        Reject
      </Button>
      <Button size={size} variant="primary" onClick={() => setDialog('approve')}>
        Approve {label}
      </Button>
      <ConfirmDialog
        open={dialog === 'approve'}
        onClose={() => setDialog(null)}
        title={`Approve this ${label}?`}
        confirmLabel={`Approve ${label}`}
        onConfirm={async () => {
          const decided = await approvalsApi.approve(approval.id, '')
          await invalidate()
          toast({
            title: `${APPROVAL_TYPE_LABELS[approval.type]} approved`,
            description: approval.subject,
          })
          onDecided?.(decided)
        }}
      >
        <p className="text-ink">{approval.subject}</p>
        {approval.amount !== null && (
          <p className="text-ink tabular text-lg font-semibold">{formatNaira(approval.amount)}</p>
        )}
        <p>
          Requested by {approval.requestedByName}. Reason: {approval.reason}
        </p>
        <p>{consequence[approval.type]}</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'reject'}
        onClose={() => setDialog(null)}
        title={`Reject this ${label}?`}
        confirmLabel={`Reject ${label}`}
        tone="danger"
        reason={{
          label: 'Why are you rejecting it?',
          hint: `${approval.requestedByName} will see this.`,
          minLength: 5,
        }}
        onConfirm={async (note) => {
          const decided = await approvalsApi.reject(approval.id, note)
          await invalidate()
          toast({
            title: `${APPROVAL_TYPE_LABELS[approval.type]} rejected`,
            description: approval.subject,
          })
          onDecided?.(decided)
        }}
      >
        <p className="text-ink">{approval.subject}</p>
      </ConfirmDialog>
    </>
  )
}

/** Banner for a record that has a pending request against it. */
export function PendingApprovalBanner({ params }: { params: ApprovalListParams }) {
  const user = useCurrentUser()
  const query = useQuery({
    queryKey: approvalKeys.list({ ...params, status: 'pending' }),
    queryFn: () => approvalsApi.list({ ...params, status: 'pending', pageSize: 5 }),
    enabled: hasPermission(user, 'approvals.view'),
  })
  const pending = query.data?.results ?? []
  if (pending.length === 0) return null
  return (
    <div className="mb-6 flex flex-col gap-2">
      {pending.map((a) => (
        <ApprovalBanner
          key={a.id}
          state="pending"
          subject={a.subject}
          requestedBy={a.requestedByName}
          requestedAt={a.requestedAt}
          reason={a.reason}
          actions={<ApprovalDecisionButtons approval={a} />}
        />
      ))}
    </div>
  )
}
