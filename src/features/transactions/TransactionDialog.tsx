import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { transactionsApi } from '@/api/transactions'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Dialog } from '@/components/ui/Dialog'
import { DescriptionList, Money } from '@/components/ui/display'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useToast } from '@/components/ui/Toast'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { formatDateTime } from '@/lib/dates'
import { hasPermission } from '@/lib/permissions'
import {
  TRANSACTION_EDITOR_ROLES,
  TRANSACTION_TYPE_LABELS,
  type Transaction,
  type TransactionEdit,
} from '@/types'
import { EditTransactionDialog } from './EditTransactionDialog'

const FIELD_LABELS: Record<TransactionEdit['changes'][number]['field'], string> = {
  amount: 'Amount',
  date: 'Date and time',
  paymentMethod: 'Paid by',
  note: 'Note',
}

const REVERSIBLE = new Set([
  'thrift_contribution',
  'loan_repayment',
  'deposit',
  'withdrawal',
  'thrift_payout',
  'transfer_out',
  'transfer_in',
])

export function signedAmount(t: Transaction) {
  return (t.direction === 'debit' ? -t.amount : t.amount) as Transaction['amount']
}

export function TransactionDialog({
  transaction: t,
  onClose,
}: {
  transaction: Transaction | null
  onClose: () => void
}) {
  const user = useCurrentUser()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [reversing, setReversing] = useState(false)
  const [editing, setEditing] = useState(false)
  // Only the MD and general managers may correct a posted transaction.
  const canEdit =
    t !== null &&
    TRANSACTION_EDITOR_ROLES.includes(user.role) &&
    hasPermission(user, 'transactions.edit') &&
    t.status === 'posted'
  const canReverse =
    t !== null &&
    hasPermission(user, 'transactions.request_reversal') &&
    t.status === 'posted' &&
    REVERSIBLE.has(t.type)

  return (
    <>
      <Dialog
        open={t !== null && !reversing && !editing}
        onClose={onClose}
        title={t ? TRANSACTION_TYPE_LABELS[t.type] : ''}
        description={t ? <span className="font-mono">{t.reference}</span> : undefined}
        footer={
          <>
            {canEdit && <Button onClick={() => setEditing(true)}>Edit</Button>}
            {canReverse && (
              <Button variant="danger" onClick={() => setReversing(true)}>
                Request reversal
              </Button>
            )}
            <Button onClick={onClose}>Close</Button>
          </>
        }
      >
        {t && (
          <div className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between gap-4">
              <Money value={signedAmount(t)} signed className="text-2xl font-semibold" />
              <span className="flex items-center gap-2">
                {t.edits?.length ? (
                  <span className="bg-ochre-tint text-ochre rounded-sm px-2 py-0.5 text-xs font-semibold">
                    Edited
                  </span>
                ) : null}
                <StatusBadge status={t.status} />
              </span>
            </div>
            <DescriptionList
              items={[
                { label: 'Date and time', value: formatDateTime(t.createdAt) },
                {
                  label: 'Customer',
                  value: (
                    <Link
                      to={`/customers/${t.customerId}`}
                      className="underline underline-offset-2"
                    >
                      {t.customerName}
                    </Link>
                  ),
                },
                {
                  label: 'Account',
                  value: (
                    <Link
                      to={`/accounts/${t.accountId}`}
                      className="font-mono underline underline-offset-2"
                    >
                      {t.accountNumber}
                    </Link>
                  ),
                },
                { label: 'Balance after', value: <Money value={t.balanceAfter} /> },
                {
                  label: 'Channel',
                  value:
                    t.channel === 'field'
                      ? 'Field collection'
                      : t.channel === 'counter'
                        ? 'Counter'
                        : 'System',
                },
                {
                  label: 'Paid by',
                  value:
                    t.paymentMethod === 'cash'
                      ? 'Cash'
                      : t.paymentMethod === 'transfer'
                        ? 'Transfer'
                        : null,
                },
                { label: 'Collected by', value: t.officerName },
                {
                  label: 'Location',
                  value: t.location ? (
                    <a
                      href={`https://www.google.com/maps?q=${t.location.lat},${t.location.lng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      {t.location.lat.toFixed(5)}, {t.location.lng.toFixed(5)}
                      {t.location.accuracyM !== null && ` (±${t.location.accuracyM} m)`}
                    </a>
                  ) : null,
                },
                { label: 'Note', value: t.narration, wide: true },
              ]}
            />
            {t.edits?.length ? (
              <section aria-labelledby="edits-heading" className="border-rule border-t pt-3">
                <h3 id="edits-heading" className="text-sm font-semibold">
                  Changes
                </h3>
                <ol className="mt-2 flex flex-col gap-3">
                  {[...t.edits].reverse().map((e) => (
                    <li key={e.at} className="text-sm">
                      <p className="text-ink-2 text-xs">
                        {formatDateTime(e.at)} · {e.byName}
                      </p>
                      <ul className="mt-1">
                        {e.changes.map((c) => (
                          <li key={c.field}>
                            {FIELD_LABELS[c.field]}: <span className="line-through">{c.from}</span>{' '}
                            → <strong>{c.to}</strong>
                          </li>
                        ))}
                      </ul>
                      <p className="text-ink-2 mt-0.5">“{e.reason}”</p>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
          </div>
        )}
      </Dialog>
      {t && editing && (
        <EditTransactionDialog
          transaction={t}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            onClose()
          }}
        />
      )}
      {t && (
        <ConfirmDialog
          open={reversing}
          onClose={() => setReversing(false)}
          title="Request a reversal"
          confirmLabel="Send for approval"
          tone="danger"
          reason={{
            label: 'Why must this be reversed?',
            hint: 'The approving manager reads this. Be specific.',
          }}
          onConfirm={async (reason) => {
            const approval = await transactionsApi.requestReversal(t.id, reason)
            await Promise.all(
              ['transactions', 'approvals'].map((k) =>
                queryClient.invalidateQueries({ queryKey: [k] }),
              ),
            )
            toast(
              approval.status === 'approved'
                ? {
                    title: 'Transaction reversed',
                    description: `${t.reference} has been reversed.`,
                  }
                : {
                    title: 'Reversal requested',
                    description: `${t.reference} is on hold until a manager approves or rejects it.`,
                  },
            )
            onClose()
          }}
        >
          <p className="text-ink">
            {t.reference} · {TRANSACTION_TYPE_LABELS[t.type]} of <Money value={t.amount} /> for{' '}
            {t.customerName}.
          </p>
          <p>
            Nothing changes until a branch manager approves. You can't approve your own request.
            {t.transferId && ' Both sides of the transfer are reversed together.'}
          </p>
        </ConfirmDialog>
      )}
    </>
  )
}
