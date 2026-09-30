import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { isApiError } from '@/api/client'
import { transactionsApi } from '@/api/transactions'
import { MoneyInput } from '@/components/form/MoneyInput'
import { TextArea, TextInput } from '@/components/form/inputs'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { SegmentedControl } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/Toast'
import type { Kobo } from '@/lib/money'
import {
  AMOUNT_EDITABLE_TYPES,
  TRANSACTION_TYPE_LABELS,
  type PaymentMethod,
  type Transaction,
  type TransactionEditRequest,
} from '@/types'

// Lagos is UTC+1 all year, so the date-time field works in that offset.
const LAGOS_MS = 60 * 60 * 1000
const toLocalInput = (iso: string) =>
  new Date(Date.parse(iso) + LAGOS_MS).toISOString().slice(0, 16)
const fromLocalInput = (value: string) => `${value}:00+01:00`

/**
 * Correct a posted transaction. Only the MD and general managers see this; the
 * server checks again. Balances after it are recalculated and the change is kept.
 */
export function EditTransactionDialog({
  transaction: t,
  onClose,
  onSaved,
}: {
  transaction: Transaction
  onClose: () => void
  onSaved: (updated: Transaction) => void
}) {
  const amountEditable = AMOUNT_EDITABLE_TYPES.includes(t.type)
  const [amount, setAmount] = useState<Kobo | null>(t.amount)
  const [when, setWhen] = useState(() => toLocalInput(t.createdAt))
  const [method, setMethod] = useState<PaymentMethod | null>(t.paymentMethod)
  const [note, setNote] = useState(t.narration ?? '')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()
  const toast = useToast()

  const submit = async () => {
    const input: TransactionEditRequest = { reason: reason.trim() }
    if (amountEditable && amount !== null && amount !== t.amount) input.amount = amount
    if (when && when !== toLocalInput(t.createdAt)) input.createdAt = fromLocalInput(when)
    if (method && method !== t.paymentMethod) input.paymentMethod = method
    if (note.trim() !== (t.narration ?? '')) input.narration = note.trim()
    const local: Record<string, string> = {}
    if (amountEditable && !amount) local.amount = 'Enter an amount greater than ₦0.'
    if (input.reason.length < 10)
      local.reason = 'Say why it is being changed (at least 10 characters).'
    if (Object.keys(input).length === 1 && !local.amount) local.form = 'Change something first.'
    setErrors(local)
    if (Object.keys(local).length) return
    setBusy(true)
    try {
      const updated = await transactionsApi.edit(t.id, input)
      await Promise.all(
        ['transactions', 'accounts', 'loans', 'remittances', 'insights'].map((k) =>
          queryClient.invalidateQueries({ queryKey: [k] }),
        ),
      )
      toast({
        title: 'Transaction updated',
        description: `${t.reference} and the balances after it.`,
      })
      onSaved(updated)
    } catch (e) {
      if (isApiError(e))
        setErrors({
          ...Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, v.join(' ')])),
          form: e.formErrors.join(' '),
        })
      else setErrors({ form: 'Nothing was changed. Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      title={`Edit ${TRANSACTION_TYPE_LABELS[t.type].toLowerCase()}`}
      description={
        <>
          <span className="font-mono">{t.reference}</span> · {t.customerName} ·{' '}
          <span className="font-mono">{t.accountNumber}</span>
        </>
      }
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <Alert tone="warning">
          Every balance after this transaction is recalculated. The change and your reason are kept
          on the transaction and in the audit log.
          {t.type === 'withdrawal' &&
            ' Its withdrawal charge, if any, isn’t changed: edit the charge separately.'}
        </Alert>
        <MoneyInput
          label="Amount"
          value={amount}
          onChange={setAmount}
          error={errors.amount}
          disabled={!amountEditable}
          hint={
            amountEditable
              ? undefined
              : 'This amount follows the loan’s terms or the original entry, so it can’t be changed here.'
          }
        />
        <TextInput
          label="Date and time"
          type="datetime-local"
          value={when}
          max={toLocalInput(new Date().toISOString())}
          onChange={(e) => setWhen(e.target.value)}
          error={errors.createdAt}
          hint="Lagos time."
        />
        {t.paymentMethod !== null && method && (
          <SegmentedControl
            label={t.direction === 'debit' ? 'Paid out by' : 'Paid by'}
            value={method}
            onChange={setMethod}
            options={[
              { value: 'cash', label: 'Cash' },
              { value: 'transfer', label: 'Transfer' },
            ]}
          />
        )}
        <TextInput
          label="Note"
          optional
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={140}
        />
        <TextArea
          label="Why is it being changed?"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={errors.reason}
          hint="Be specific, e.g. “Officer entered ₦5,000 instead of ₦500”."
        />
      </div>
    </Dialog>
  )
}
